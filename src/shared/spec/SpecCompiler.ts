import type { ChipSpec, InstructionForm, OperandKind, RegisterBit, RegisterSpec } from './ChipSpec';

export const DEFAULT_DOCUMENT_SOURCE = 'HK8S8100X_\u89c4\u683c\u4e66 V0.1.docx';

export type SpecSourceRow = Record<string, string | number | undefined | null>;

export interface RegisterSourceRow {
  row: SpecSourceRow;
  notes: string[];
}

export interface CompileSpecInput {
  chipId?: string;
  displayName?: string;
  version?: string;
  instructionRows: SpecSourceRow[];
  registerRows: Array<SpecSourceRow | RegisterSourceRow>;
  instructionSource?: string;
  registerSource?: string;
  documentSource?: string;
}

function text(value: string | number | undefined | null): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

function field(row: SpecSourceRow, ...names: string[]): string {
  for (const name of names) {
    const value = text(row[name]);
    if (value) return value;
  }
  return '';
}

export function normalizeAddress(value: string | number): number {
  const raw = text(value);
  if (/^[0-9A-Fa-f]+H$/i.test(raw)) {
    return Number.parseInt(raw.slice(0, -1), 16);
  }
  if (/^0x[0-9A-Fa-f]+$/i.test(raw)) {
    return Number.parseInt(raw.slice(2), 16);
  }
  throw new Error(`Unsupported address format: ${value}`);
}

function normalizeHex(value: string | number): string {
  const raw = text(value);
  const digits = /^0x([0-9A-Fa-f]+)$/i.exec(raw)?.[1] ?? /^([0-9A-Fa-f]+)H$/i.exec(raw)?.[1];
  if (!digits) throw new Error(`Unsupported hex value: ${value}`);
  return `0x${digits.toUpperCase()}`;
}

function parseFlags(value: string): string[] {
  return value
    .split(',')
    .map((flag) => flag.trim().toUpperCase())
    .filter(Boolean);
}

function normalizeCycles(value: string): number {
  const raw = value.trim();
  const firstNumber = /^\d+/.exec(raw)?.[0];
  if (!firstNumber) throw new Error(`Unsupported cycles value: ${value}`);
  return Number(firstNumber);
}

function normalizeOperand(value: string): OperandKind {
  const operand = value.trim() as OperandKind;
  if (operand === '' || operand === 'r8' || operand === 'k8' || operand === 'k10' || operand === 'r8,b') {
    return operand;
  }
  throw new Error(`Unsupported operand kind: ${value}`);
}

export function normalizeInstructionRow(row: SpecSourceRow): InstructionForm {
  const wordBits = Number(field(row, 'word_bits', 'wordBits') || 16);
  const cyclesRaw = field(row, 'cycles');
  if (wordBits !== 16) throw new Error(`Unsupported instruction width: ${wordBits}`);

  const form: InstructionForm = {
    mnemonic: field(row, 'mnemonic').toUpperCase(),
    asmSyntax: normalizeAsmSyntax(field(row, 'asm_syntax', 'asmSyntax')),
    operands: normalizeOperand(field(row, 'operands')),
    wordBits,
    opcodePattern: field(row, 'opcode_pattern', 'opcodePattern'),
    maskHex: normalizeHex(field(row, 'mask_hex', 'maskHex')),
    valueHex: normalizeHex(field(row, 'value_hex', 'valueHex')),
    cycles: normalizeCycles(cyclesRaw),
    cyclesRaw,
    flagsAffected: parseFlags(field(row, 'flags_affected', 'flagsAffected')),
    notes: field(row, 'notes')
  };

  assertInstructionConsistency(form);
  return form;
}

/**
 * 源数据一致性自检：用三列互相独立的源数据（asmSyntax 文本、operands 类型、opcodePattern 位模板）
 * 交叉验证操作数类型。任一列写错（如 MOV A,#K 的 operands 误填 r8）都会在编译期直接报错，
 * 而不是让错误悄悄进入规范库、再让校验器拿错误的“标准答案”给非法代码假背书。
 */
export function assertInstructionConsistency(form: InstructionForm): void {
  const operandText = getAsmSyntaxOperandText(form.asmSyntax);
  const hasImmediateSyntax = operandText.includes('#');
  const hasBitSyntax = /,\s*b\b/.test(operandText) || /\bb$/.test(operandText.trim());

  const pattern = form.opcodePattern;
  const patternHasK = /k/.test(pattern);
  const patternHasR = /r/.test(pattern);
  const patternHasB = /b/.test(pattern);

  // 1) asmSyntax 含 # 立即数 → operands 必须是 k8/k10
  if (hasImmediateSyntax && form.operands !== 'k8' && form.operands !== 'k10') {
    throw new Error(
      `Spec inconsistency for "${form.asmSyntax}": immediate syntax (#K) requires operands k8/k10, got "${form.operands}".`
    );
  }

  // 2) asmSyntax 含 ,b 位操作 → operands 必须是 r8,b
  if (hasBitSyntax && form.operands !== 'r8,b') {
    throw new Error(
      `Spec inconsistency for "${form.asmSyntax}": bit syntax (,b) requires operands r8,b, got "${form.operands}".`
    );
  }

  // 3) opcodePattern 的变量字母（k/r/b）必须与 operands 类型一致——两列独立源数据互检
  const expected: Record<InstructionForm['operands'], { k: boolean; r: boolean; b: boolean }> = {
    '': { k: false, r: false, b: false },
    k8: { k: true, r: false, b: false },
    k10: { k: true, r: false, b: false },
    r8: { k: false, r: true, b: false },
    'r8,b': { k: false, r: true, b: true }
  };
  const want = expected[form.operands];
  if (patternHasK !== want.k || patternHasR !== want.r || patternHasB !== want.b) {
    throw new Error(
      `Spec inconsistency for "${form.asmSyntax}": operands "${form.operands}" expects opcode pattern variables ` +
        `{k:${want.k}, r:${want.r}, b:${want.b}} but pattern "${pattern}" has {k:${patternHasK}, r:${patternHasR}, b:${patternHasB}}.`
    );
  }
}

function getAsmSyntaxOperandText(asmSyntax: string): string {
  const trimmed = asmSyntax.trim();
  const firstWhitespace = trimmed.search(/\s/);
  return firstWhitespace === -1 ? '' : trimmed.slice(firstWhitespace).trim();
}

function normalizeAsmSyntax(value: string): string {
  return (
    {
      'XOR A.#K': 'XOR A,#K',
      'BTSZ,R,b': 'BTSZ R,b',
      'BTSNZ,R,b': 'BTSNZ R,b'
    }[value] ?? value
  );
}

function findBitDescriptionSeparator(value: string): number {
  let bracketDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '[') {
      bracketDepth += 1;
      continue;
    }
    if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (bracketDepth === 0 && (char === ':' || char === '\uff1a')) {
      return index;
    }
  }

  return -1;
}

function normalizeBitCell(value: string): { name: string; description: string } | undefined {
  const raw = value.trim();
  if (!raw || raw === '-') return undefined;

  const separator = findBitDescriptionSeparator(raw);
  if (separator === -1) return { name: raw, description: '' };

  const name = raw.slice(0, separator).trim();
  const description = raw.slice(separator + 1).trim();
  return name ? { name, description } : undefined;
}

export function normalizeRegisterRow(row: SpecSourceRow, rowNotes?: string[]): RegisterSpec {
  const kind = field(row, 'kind').toUpperCase();
  if (kind !== 'SFR' && kind !== 'OPTION') throw new Error(`Unsupported register kind: ${kind}`);

  const bits: RegisterBit[] = [
    ['bit7', 7],
    ['bit6', 6],
    ['bit5', 5],
    ['bit4', 4],
    ['bit3', 3],
    ['bit2', 2],
    ['bit1', 1],
    ['bit0', 0]
  ].flatMap(([column, bit]) => {
    const normalized = normalizeBitCell(field(row, String(column)));
    return normalized ? [{ bit: Number(bit), ...normalized }] : [];
  });

  const notes = rowNotes ?? field(row, 'notes').split(/\r?\n/).map((note) => note.trim()).filter(Boolean);
  const addressText = field(row, 'address');

  return {
    name: field(row, 'name'),
    address: normalizeAddress(addressText),
    addressText,
    kind,
    resetValue: normalizeHex(field(row, 'reset_value', 'resetValue')),
    bits,
    notes
  };
}

function normalizeRegisterInput(input: SpecSourceRow | RegisterSourceRow): RegisterSourceRow {
  if (isRegisterSourceRow(input)) {
    return {
      row: input.row,
      notes: input.notes ?? []
    };
  }

  return { row: input, notes: field(input, 'notes').split(/\r?\n/).map((note) => note.trim()).filter(Boolean) };
}

function isRegisterSourceRow(input: SpecSourceRow | RegisterSourceRow): input is RegisterSourceRow {
  return 'row' in input && typeof input.row === 'object' && input.row !== null && !Array.isArray(input.row);
}

export function compileSpec(input: CompileSpecInput): ChipSpec {
  return {
    chipId: input.chipId ?? 'HK8S8100X',
    displayName: input.displayName ?? 'HK8S8100X',
    version: input.version ?? '0.1',
    instructionSource: input.instructionSource ?? 'instruction_set.xlsx',
    registerSource: input.registerSource ?? 'register_set.xlsx',
    documentSource: input.documentSource ?? DEFAULT_DOCUMENT_SOURCE,
    instructions: input.instructionRows.filter((row) => field(row, 'mnemonic')).map(normalizeInstructionRow),
    registers: input.registerRows.map(normalizeRegisterInput).map(({ row, notes }) => normalizeRegisterRow(row, notes)),
    memory: [
      { name: 'SFR', start: 0x00, end: 0x7f },
      { name: 'RAM', start: 0x80, end: 0xbf }
    ],
    vectors: {
      reset: 0x000,
      interrupt: 0x008
    },
    asmSyntax: {
      labelPattern: '^[A-Za-z_][A-Za-z0-9_]*:$',
      commentPrefix: ';',
      includeDirective: 'INCLUDE',
      constantDirective: 'EQU',
      originDirective: 'ORG'
    }
  };
}
