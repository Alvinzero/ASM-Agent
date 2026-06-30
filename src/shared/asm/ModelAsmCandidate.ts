import type { GeneratedFile } from '../project/ProjectTypes';
import type { ChipSpec, RegisterSpec } from '../spec/ChipSpec';
import { assertAsmSourcePassesQualityGate } from './AsmQualityGate';
import { parseAsm, type AsmInstructionLine } from './AsmParser';

export interface ModelAsmGeneratedFileInput {
  modelResponse: string;
  spec: ChipSpec;
  requirement?: string;
  fileName?: string;
}

const ASM_CODE_BLOCK_PATTERN = /```(?:asm|assembly)\s*\n([\s\S]*?)```/i;
const PA_BLINK_KEYWORD_PATTERN = /(?:彩灯|灯|LED|闪烁|闪灯|blink|blinking|flash|flashing)/i;
const DELAY_TOLERANCE_RATIO = 0.55;

export function buildModelAsmGeneratedFile(input: ModelAsmGeneratedFileInput): GeneratedFile {
  const source = extractAsmCodeBlock(input.modelResponse);
  assertAsmSourcePassesQualityGate(source, input.spec);
  assertModelAsmMatchesRequirement(source, input.spec, input.requirement);

  return {
    path: sanitizeAsmFileName(input.fileName),
    content: ensureTrailingNewline(source)
  };
}

export function extractAsmCodeBlock(modelResponse: string): string {
  const match = modelResponse.match(ASM_CODE_BLOCK_PATTERN);
  if (!match) {
    throw new Error('模型没有返回可质检的 ASM 代码块。');
  }

  return trimOuterBlankLines(match[1]);
}

function trimOuterBlankLines(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');

  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();

  return lines.join('\n');
}

function sanitizeAsmFileName(fileName?: string): string {
  const baseName = (fileName ?? 'main.asm')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.trim()
    .replace(/\.asm$/i, '')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `${baseName || 'main'}.asm`;
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`;
}

function assertModelAsmMatchesRequirement(source: string, spec: ChipSpec, requirement?: string): void {
  const paRequirement = extractPaBlinkRequirement(requirement);
  if (!paRequirement) return;

  const paPio = spec.registers.find((register) => register.name.toUpperCase() === 'PA_PIO');
  if (!paPio) return;

  const states = collectExplicitPaPioStates(source, paPio);
  const distinctStates = Array.from(new Set(states.map((state) => state.mask)));
  const requestedMask = paRequirement.pins.reduce((mask, pin) => mask | (1 << pin), 0);
  const stateUnion = distinctStates.reduce((mask, state) => mask | state, 0);
  const missingPins = paRequirement.pins.filter((pin) => (stateUnion & (1 << pin)) === 0);
  const staticPins = paRequirement.pins.filter((pin) => {
    const bit = 1 << pin;
    return !distinctStates.some((state) => (state & bit) !== 0) || !distinctStates.some((state) => (state & bit) === 0);
  });
  const errors: string[] = [];

  if (distinctStates.length < 2 || missingPins.length > 0 || staticPins.length > 0) {
    errors.push(
      [
        '需求要求',
        paRequirement.pins.map((pin) => `PA${pin}`).join('/'),
        '彩灯闪烁，但模型没有用明确灯态写 PA_PIO(38H) 覆盖并切换这些引脚。',
        `请使用明确掩码写入 PA_PIO，例如 ${formatMaskExamples(paRequirement.pins)}，`,
        '并在每个可见灯态后调用 DELAY；不要用 #01H OR 计数器这类会让 PA0 常亮的计算掩码。'
      ].join('')
    );
  }

  const writesRequestedPins = states.filter((state) => (state.mask & requestedMask) !== 0);
  if (writesRequestedPins.length > 1 && !hasDelayCall(source)) {
    errors.push('PA 彩灯闪烁状态之间缺少 CALL DELAY 这类可见延时。');
  }

  if (hasDelayCall(source) && usesNonWriteBackSkipCounter(source)) {
    errors.push(
      'DECSZ 不会把减 1 结果写回 RAM，INCSZ 不会把加 1 结果写回 RAM，用它们做 DELAY 计数器会卡在某个灯态。软件延时计数器必须使用 DECSZR/INCSZR 这类会回写 RAM 的指令。'
    );
  }

  const delayEstimate = estimateRequestedDelay(source, requirement);
  if (delayEstimate && delayEstimate.estimatedMs > delayEstimate.requestedMs * (1 + DELAY_TOLERANCE_RATIO)) {
    errors.push(
      [
        `软件延时估算约 ${Math.round(delayEstimate.estimatedMs)}ms，明显大于用户要求的 ${delayEstimate.requestedMs}ms。`,
        '请按主频和指令周期重新缩小 DELAY 外层计数；16MHz 下三层 #0AH/#FFH/#FFH 约为 500ms 量级，#7AH/#FFH/#FFH 会远超 500ms。'
      ].join('')
    );
  }

  if (errors.length > 0) {
    throw new Error(`ASM 需求行为质检失败：${errors.join('；')}`);
  }
}

function extractPaBlinkRequirement(requirement?: string): { pins: number[] } | null {
  if (!requirement || !PA_BLINK_KEYWORD_PATTERN.test(requirement)) return null;

  const pins = new Set<number>();
  for (const match of requirement.matchAll(/PA\s*([0-7])/gi)) {
    pins.add(Number.parseInt(match[1], 10));
  }

  if (pins.size === 0) return null;

  return {
    pins: [...pins].sort((left, right) => left - right)
  };
}

function collectExplicitPaPioStates(source: string, paPio: RegisterSpec): Array<{ lineNumber: number; mask: number }> {
  const instructions = parseAsm(source).lines.filter((line): line is AsmInstructionLine => line.kind === 'instruction');
  const states: Array<{ lineNumber: number; mask: number }> = [];

  for (let index = 0; index < instructions.length; index += 1) {
    const instruction = instructions[index];

    if (instruction.mnemonic === 'CLR' && isPaPioOperand(instruction.operands[0], paPio)) {
      states.push({ lineNumber: instruction.lineNumber, mask: 0 });
      continue;
    }

    if (
      instruction.mnemonic === 'MOV' &&
      isPaPioOperand(instruction.operands[0], paPio) &&
      instruction.operands[1]?.toUpperCase() === 'A'
    ) {
      const previous = findPreviousInstruction(instructions, index);
      if (previous?.mnemonic !== 'MOV' || previous.operands[0]?.toUpperCase() !== 'A') continue;

      const mask = parseImmediateByte(previous.operands[1]);
      if (mask === undefined) continue;

      states.push({ lineNumber: instruction.lineNumber, mask });
    }
  }

  return states;
}

function findPreviousInstruction(instructions: AsmInstructionLine[], index: number): AsmInstructionLine | undefined {
  return index > 0 ? instructions[index - 1] : undefined;
}

function isPaPioOperand(operand: string | undefined, paPio: RegisterSpec): boolean {
  const normalized = operand?.trim().toUpperCase();
  return normalized === paPio.name.toUpperCase() || normalized === paPio.addressText.toUpperCase();
}

function parseImmediateByte(operand: string | undefined): number | undefined {
  if (!operand?.startsWith('#')) return undefined;

  const value = operand.slice(1).trim();
  if (/^[0-9a-f]+h$/i.test(value)) return Number.parseInt(value.slice(0, -1), 16);
  if (/^0x[0-9a-f]+$/i.test(value)) return Number.parseInt(value.slice(2), 16);
  if (/^[0-9]+$/u.test(value)) return Number.parseInt(value, 10);

  return undefined;
}

function hasDelayCall(source: string): boolean {
  return parseAsm(source).lines.some(
    (line) => line.kind === 'instruction' && line.mnemonic === 'CALL' && /delay/i.test(line.operands[0] ?? '')
  );
}

function usesNonWriteBackSkipCounter(source: string): boolean {
  return parseAsm(source).lines.some(
    (line) => line.kind === 'instruction' && (line.mnemonic === 'DECSZ' || line.mnemonic === 'INCSZ')
  );
}

function estimateRequestedDelay(
  source: string,
  requirement?: string
): { requestedMs: number; estimatedMs: number } | null {
  const requestedMs = extractRequestedDelayMs(requirement);
  const clockHz = extractClockHz(requirement);
  if (!requestedMs || !clockHz) return null;

  const loopCounts = extractNestedDelayLoopCounts(source);
  if (!loopCounts || loopCounts.length < 2) return null;

  const estimatedCycles = estimateNestedDecrementLoopCycles(loopCounts);
  return {
    requestedMs,
    estimatedMs: (estimatedCycles / clockHz) * 1000
  };
}

function extractRequestedDelayMs(requirement?: string): number | null {
  if (!requirement) return null;

  const msMatch = requirement.match(/(\d+(?:\.\d+)?)\s*(?:ms|毫秒)/i);
  if (msMatch) return Number.parseFloat(msMatch[1]);

  const secondMatch = requirement.match(/(\d+(?:\.\d+)?)\s*(?:s|秒)/i);
  if (secondMatch) return Number.parseFloat(secondMatch[1]) * 1000;

  return null;
}

function extractClockHz(requirement?: string): number | null {
  if (!requirement) return null;

  const mhzMatch = requirement.match(/(?:主频|时钟|clock|freq|frequency)?\s*(\d+(?:\.\d+)?)\s*(?:mhz|m\b|M\b|兆)/i);
  if (mhzMatch) return Number.parseFloat(mhzMatch[1]) * 1_000_000;

  const hzMatch = requirement.match(/(?:主频|时钟|clock|freq|frequency)?\s*(\d+(?:\.\d+)?)\s*(?:hz|赫兹)/i);
  if (hzMatch) return Number.parseFloat(hzMatch[1]);

  return null;
}

function extractNestedDelayLoopCounts(source: string): number[] | null {
  const instructions = parseAsm(source).lines.filter((line): line is AsmInstructionLine => line.kind === 'instruction');
  const counts: number[] = [];

  for (let index = 0; index < instructions.length; index += 1) {
    const instruction = instructions[index];
    if (instruction.mnemonic !== 'DECSZR' && instruction.mnemonic !== 'INCSZR') continue;

    const counter = instruction.operands[0]?.toUpperCase();
    const initialValue = findCounterInitialValue(instructions, index, counter);
    if (initialValue === undefined) return null;

    counts.push(initialValue === 0 ? 256 : initialValue);
  }

  return counts.length > 0 ? counts : null;
}

function findCounterInitialValue(
  instructions: AsmInstructionLine[],
  beforeIndex: number,
  counter: string | undefined
): number | undefined {
  if (!counter) return undefined;

  for (let index = beforeIndex - 1; index > 0; index -= 1) {
    const current = instructions[index];
    const previous = instructions[index - 1];
    if (
      current.mnemonic === 'MOV' &&
      current.operands[0]?.toUpperCase() === counter &&
      current.operands[1]?.toUpperCase() === 'A' &&
      previous.mnemonic === 'MOV' &&
      previous.operands[0]?.toUpperCase() === 'A'
    ) {
      return parseImmediateByte(previous.operands[1]);
    }
  }

  return undefined;
}

function estimateNestedDecrementLoopCycles(loopCounts: number[]): number {
  const innerLoopCycles = (count: number) => count * 3;
  let cycles = innerLoopCycles(loopCounts[0]);

  for (const count of loopCounts.slice(1)) {
    cycles = count * (2 + cycles + 3);
  }

  return cycles + 2;
}

function formatMaskExamples(pins: number[]): string {
  return pins.map((pin) => `#${(1 << pin).toString(16).toUpperCase().padStart(2, '0')}H`).join('、');
}
