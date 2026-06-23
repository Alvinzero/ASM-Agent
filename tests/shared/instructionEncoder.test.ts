import { describe, expect, it } from 'vitest';
import { encodeInstruction } from '../../src/shared/asm/InstructionEncoder';
import { BuiltInSpecRepository } from '../../src/shared/spec/BuiltInSpecRepository';
import type { InstructionForm } from '../../src/shared/spec/ChipSpec';

const spec = new BuiltInSpecRepository().getByChipId('HK8S8100X');

function findForm(mnemonic: string, asmSyntax: string): InstructionForm {
  const form = spec.instructions.find(
    (instruction) => instruction.mnemonic === mnemonic && instruction.asmSyntax === asmSyntax
  );

  if (!form) {
    throw new Error(`Missing instruction form ${asmSyntax}`);
  }

  return form;
}

describe('InstructionEncoder', () => {
  it('encodes k10 operands into JMP low bits', () => {
    const jmp = findForm('JMP', 'JMP K');

    expect(encodeInstruction(jmp, [0x008]).word).toBe(0xc008);
  });

  it('rejects k10 operands outside the ten-bit range', () => {
    const jmp = findForm('JMP', 'JMP K');

    expect(() => encodeInstruction(jmp, [0x400])).toThrow('k10 operand out of range: 1024');
  });

  it('encodes k8 and r8 forms using the low eight bits', () => {
    expect(encodeInstruction(findForm('ADD', 'ADD A,#K'), [0x12]).word).toBe(0x1012);
    expect(encodeInstruction(findForm('ADD', 'ADD A,R'), [0x10]).word).toBe(0x1110);
  });

  it('encodes r8,b forms with bit number in bits 10..8 and register in low bits', () => {
    const bset = findForm('BSET', 'BSET R,b');

    expect(encodeInstruction(bset, [0x10, 5]).word).toBe(0x5d10);
  });

  it('rejects r8,b bit operands outside the three-bit range', () => {
    const bset = findForm('BSET', 'BSET R,b');

    expect(() => encodeInstruction(bset, [0x10, 8])).toThrow('b operand out of range: 8');
  });
});
