import type { InstructionForm } from '../spec/ChipSpec';

export interface EncodedInstruction {
  word: number;
}

export function encodeInstruction(form: InstructionForm, operands: number[]): EncodedInstruction {
  let word = parseWord(form.valueHex);

  switch (form.operands) {
    case '':
      requireOperandCount(form, operands, 0);
      break;
    case 'k8':
      requireOperandCount(form, operands, 1);
      word |= requireRange('k8', operands[0], 0xff);
      break;
    case 'k10':
      requireOperandCount(form, operands, 1);
      word |= requireRange('k10', operands[0], 0x3ff);
      break;
    case 'r8':
      requireOperandCount(form, operands, 1);
      word |= requireRange('r8', operands[0], 0xff);
      break;
    case 'r8,b': {
      requireOperandCount(form, operands, 2);
      const register = requireRange('r8', operands[0], 0xff);
      const bit = requireRange('b', operands[1], 0x07);
      word |= (bit << 8) | register;
      break;
    }
    default:
      throw new Error(`Unsupported operand kind: ${String(form.operands)}`);
  }

  assertMaskValue(form, word);
  return { word };
}

export function assertMaskValue(form: InstructionForm, word: number): void {
  const mask = parseWord(form.maskHex);
  const value = parseWord(form.valueHex);

  if ((word & mask) !== value) {
    throw new Error(
      `Encoded word 0x${word.toString(16).toUpperCase()} does not match mask/value for ${
        form.asmSyntax
      }`
    );
  }
}

function requireOperandCount(form: InstructionForm, operands: number[], expected: number): void {
  if (operands.length !== expected) {
    throw new Error(
      `${form.asmSyntax} expects ${expected} operand${expected === 1 ? '' : 's'}, got ${
        operands.length
      }`
    );
  }
}

function requireRange(name: string, value: number, max: number): number {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`${name} operand out of range: ${value}`);
  }

  return value;
}

function parseWord(hex: string): number {
  return Number.parseInt(hex, 16);
}
