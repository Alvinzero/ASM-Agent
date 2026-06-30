import type { AsmInstructionLine, AsmProgram } from './AsmParser';
import { encodeInstruction } from './InstructionEncoder';
import type { ChipSpec, InstructionForm, RegisterSpec } from '../spec/ChipSpec';

export interface AsmDiagnostic {
  severity: 'warning' | 'error';
  code: string;
  lineNumber: number;
  message: string;
}

type MatchResult =
  | {
      ok: true;
      operands: number[];
    }
  | {
      ok: false;
      code: string;
      message: string;
      score: number;
    };

type OperandMatchResult =
  | {
      ok: true;
      value: number;
      score: number;
    }
  | {
      ok: false;
      code: string;
      message: string;
      score: number;
    };

type ValidationContext = {
  registers: Map<string, RegisterSpec>;
  labels: Set<string>;
  labelPattern: RegExp;
};

export function validateAsm(program: AsmProgram, spec: ChipSpec): AsmDiagnostic[] {
  const diagnostics: AsmDiagnostic[] = [];
  const instructionMap = buildInstructionMap(spec.instructions);
  const context: ValidationContext = {
    registers: buildRegisterMap(spec.registers),
    labels: buildLabelSet(program),
    labelPattern: createOperandLabelPattern(spec.asmSyntax.labelPattern)
  };

  for (const line of program.lines) {
    if (line.kind !== 'instruction') continue;

    const forms = instructionMap.get(line.mnemonic);
    if (!forms) {
      diagnostics.push(createDiagnostic(line, 'UNKNOWN_INSTRUCTION', `Unknown instruction: ${line.mnemonic}`));
      continue;
    }

    const matches = forms.map((form) => matchForm(line, form, context));
    const matched = matches.find((match) => match.ok);

    if (matched?.ok) {
      const form = forms[matches.indexOf(matched)];
      const encodingDiagnostic = validateEncoding(line, form, matched.operands);
      if (encodingDiagnostic) diagnostics.push(encodingDiagnostic);
      continue;
    }

    const failure = chooseFailure(matches);
    diagnostics.push(createDiagnostic(line, failure.code, failure.message));
  }

  return diagnostics;
}

function buildInstructionMap(instructions: InstructionForm[]): Map<string, InstructionForm[]> {
  const map = new Map<string, InstructionForm[]>();

  for (const instruction of instructions) {
    const mnemonic = instruction.mnemonic.toUpperCase();
    const forms = map.get(mnemonic) ?? [];
    forms.push(instruction);
    map.set(mnemonic, forms);
  }

  return map;
}

function buildRegisterMap(registers: RegisterSpec[]): Map<string, RegisterSpec> {
  return new Map(registers.map((register) => [register.name.toUpperCase(), register]));
}

function buildLabelSet(program: AsmProgram): Set<string> {
  const labels = new Set<string>();

  for (const line of program.lines) {
    if (line.kind === 'label') labels.add(line.label);
  }

  return labels;
}

function matchForm(
  line: AsmInstructionLine,
  form: InstructionForm,
  context: ValidationContext
): MatchResult {
  const expectedOperands = getSyntaxOperands(form);

  if (expectedOperands.length !== line.operands.length) {
    return {
      ok: false,
      code: 'OPERAND_SHAPE_MISMATCH',
      message: `${line.mnemonic} operand count does not match ${form.asmSyntax}`,
      score: 0
    };
  }

  const encodedOperands: number[] = [];
  let score = 0;

  for (let index = 0; index < expectedOperands.length; index += 1) {
    const result = matchOperand(expectedOperands[index], line.operands[index], form, context);
    if (!result.ok) {
      return {
        ...result,
        score: score + result.score
      };
    }
    score += result.score;
    if (isEncodedOperand(expectedOperands[index])) encodedOperands.push(result.value);
  }

  return {
    ok: true,
    operands: encodedOperands
  };
}

function isEncodedOperand(expected: string): boolean {
  return expected === '#K' || expected === 'K' || expected === 'R' || expected === 'b';
}

function getSyntaxOperands(form: InstructionForm): string[] {
  const syntax = form.asmSyntax.trim();
  const firstWhitespace = syntax.search(/\s/);

  if (firstWhitespace === -1) return [];

  return syntax
    .slice(firstWhitespace)
    .trim()
    .split(',')
    .map((operand) => operand.trim());
}

function matchOperand(
  expected: string,
  actual: string,
  form: InstructionForm,
  context: ValidationContext
): OperandMatchResult {
  if (expected === '#K') return matchImmediate(actual);
  if (expected === 'K') return matchK(actual, form, context);
  if (expected === 'R') return matchRegister(actual, context);
  if (expected === 'b') return matchBit(actual);

  if (actual.toUpperCase() === expected.toUpperCase()) {
    return {
      ok: true,
      value: 0,
      score: 1
    };
  }

  return {
    ok: false,
    code: 'OPERAND_SHAPE_MISMATCH',
    message: `Expected ${expected}, got ${actual || '<empty>'}`,
    score: 0
  };
}

function matchImmediate(actual: string): OperandMatchResult {
  if (!actual.startsWith('#')) {
    return {
      ok: false,
      code: 'OPERAND_SHAPE_MISMATCH',
      message: `Expected immediate operand, got ${actual || '<empty>'}`,
      score: 0
    };
  }

  const parsed = parseNumber(actual.slice(1));
  if (parsed === undefined) {
    return {
      ok: false,
      code: 'OPERAND_SHAPE_MISMATCH',
      message: `Invalid immediate operand: ${actual}`,
      score: 1
    };
  }

  return requireRange('k8', parsed, 0xff, 1);
}

function matchK(
  actual: string,
  form: InstructionForm,
  context: ValidationContext
): OperandMatchResult {
  if (actual.startsWith('#')) {
    return {
      ok: false,
      code: 'OPERAND_SHAPE_MISMATCH',
      message: `Expected address operand, got ${actual || '<empty>'}`,
      score: 0
    };
  }

  const parsed = parseAsmAddressNumber(actual);
  const operandName = form.operands === 'k8' ? 'k8' : 'k10';
  const max = operandName === 'k8' ? 0xff : 0x3ff;

  if (parsed !== undefined) return requireRange(operandName, parsed, max, 0);

  if (isNumericLiteralLike(actual)) {
    return {
      ok: false,
      code: 'OPERAND_SHAPE_MISMATCH',
      message: `Address operand must use H suffix: ${actual}`,
      score: 0
    };
  }

  if (!context.labelPattern.test(actual)) {
    return {
      ok: false,
      code: 'OPERAND_SHAPE_MISMATCH',
      message: `Invalid label operand: ${actual || '<empty>'}`,
      score: 0
    };
  }

  if (!context.labels.has(actual)) {
    return {
      ok: false,
      code: 'UNKNOWN_LABEL',
      message: `Unknown label: ${actual}`,
      score: 0
    };
  }

  return {
    ok: true,
    value: 0,
    score: 0
  };
}

function matchRegister(actual: string, context: ValidationContext): OperandMatchResult {
  if (actual.startsWith('#')) {
    return {
      ok: false,
      code: 'OPERAND_SHAPE_MISMATCH',
      message: `Expected register operand, got ${actual || '<empty>'}`,
      score: 0
    };
  }

  const parsed = parseAsmAddressNumber(actual);
  if (parsed !== undefined) return requireRange('r8', parsed, 0xff, 0);

  if (isNumericLiteralLike(actual)) {
    return {
      ok: false,
      code: 'OPERAND_SHAPE_MISMATCH',
      message: `Register address must use H suffix: ${actual}`,
      score: 1
    };
  }

  if (!context.labelPattern.test(actual)) {
    return {
      ok: false,
      code: 'OPERAND_SHAPE_MISMATCH',
      message: `Invalid register operand: ${actual || '<empty>'}`,
      score: 0
    };
  }

  const register = context.registers.get(actual.toUpperCase());
  if (!register) {
    return {
      ok: false,
      code: 'UNKNOWN_REGISTER',
      message: `Unknown register: ${actual}`,
      score: 0
    };
  }

  return requireRange('r8', register.address, 0xff, 0);
}

function matchBit(actual: string): OperandMatchResult {
  const parsed = parseNumber(actual);

  if (parsed === undefined) {
    return {
      ok: false,
      code: 'OPERAND_SHAPE_MISMATCH',
      message: `Invalid bit operand: ${actual || '<empty>'}`,
      score: 0
    };
  }

  return requireRange('b', parsed, 0x07, 0);
}

function requireRange(
  name: string,
  value: number,
  max: number,
  score: number
): OperandMatchResult {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    return {
      ok: false,
      code: 'OPERAND_OUT_OF_RANGE',
      message: `${name} operand out of range: ${value}`,
      score
    };
  }

  return {
    ok: true,
    value,
    score
  };
}

function parseNumber(value: string): number | undefined {
  const trimmed = value.trim();

  if (/^0x[0-9a-f]+$/i.test(trimmed)) return Number.parseInt(trimmed.slice(2), 16);
  if (/^[0-9]+$/u.test(trimmed)) return Number.parseInt(trimmed, 10);
  if (/^[0-9a-f]+h$/i.test(trimmed)) return Number.parseInt(trimmed.slice(0, -1), 16);

  return undefined;
}

function parseAsmAddressNumber(value: string): number | undefined {
  const trimmed = value.trim();

  if (/^[0-9a-f]+h$/i.test(trimmed)) return Number.parseInt(trimmed.slice(0, -1), 16);

  return undefined;
}

function isNumericLiteralLike(value: string): boolean {
  return /^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value.trim());
}

function chooseFailure(matches: MatchResult[]): { code: string; message: string } {
  const highestScore = Math.max(
    ...matches.map((candidate) => (candidate.ok ? Number.NEGATIVE_INFINITY : candidate.score))
  );
  const relevantMatches = matches.filter(
    (candidate) => !candidate.ok && candidate.score === highestScore
  );
  const priority = [
    'UNKNOWN_REGISTER',
    'UNKNOWN_LABEL',
    'OPERAND_OUT_OF_RANGE',
    'ENCODING_ERROR',
    'OPERAND_SHAPE_MISMATCH'
  ];

  for (const code of priority) {
    const match = relevantMatches.find((candidate) => !candidate.ok && candidate.code === code);
    if (match && !match.ok) return match;
  }

  return {
    code: 'OPERAND_SHAPE_MISMATCH',
    message: 'Operand shape does not match any instruction form'
  };
}

function createOperandLabelPattern(labelPattern: string): RegExp {
  const source = labelPattern.trim().replace(/:\$$/u, '$');

  return new RegExp(source);
}

function validateEncoding(
  line: AsmInstructionLine,
  form: InstructionForm,
  operands: number[]
): AsmDiagnostic | undefined {
  try {
    encodeInstruction(form, operands);
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = message.includes('operand out of range')
      ? 'OPERAND_OUT_OF_RANGE'
      : 'ENCODING_ERROR';

    return createDiagnostic(line, code, message);
  }
}

function createDiagnostic(
  line: AsmInstructionLine,
  code: string,
  message: string
): AsmDiagnostic {
  return {
    severity: 'error',
    code,
    lineNumber: line.lineNumber,
    message
  };
}
