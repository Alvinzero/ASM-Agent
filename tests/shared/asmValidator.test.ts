import { describe, expect, it } from 'vitest';
import { parseAsm } from '../../src/shared/asm/AsmParser';
import { validateAsm } from '../../src/shared/asm/AsmValidator';
import { BuiltInSpecRepository } from '../../src/shared/spec/BuiltInSpecRepository';

const spec = new BuiltInSpecRepository().getByChipId('HK8S8100X');

function diagnosticCodes(source: string): string[] {
  return validateAsm(parseAsm(source), spec).map((diagnostic) => diagnostic.code);
}

describe('AsmValidator', () => {
  it('accepts valid zero-operand and k10 instructions', () => {
    expect(validateAsm(parseAsm('CLRWDT\nJMP 0x008'), spec)).toEqual([]);
  });

  it('reports unknown instructions', () => {
    expect(diagnosticCodes('MOVX A,#0x00')).toEqual(['UNKNOWN_INSTRUCTION']);
  });

  it('reports k10 operands outside the ten-bit range', () => {
    expect(diagnosticCodes('JMP 0x400')).toEqual(['OPERAND_OUT_OF_RANGE']);
  });

  it('reports immediate range errors from the most relevant same-mnemonic form', () => {
    expect(diagnosticCodes('MOV A,#0x100')).toEqual(['OPERAND_OUT_OF_RANGE']);
  });

  it('matches same-mnemonic immediate and register forms by syntax shape', () => {
    expect(validateAsm(parseAsm('ADD A,#0x12\nADD A,0x10'), spec)).toEqual([]);
  });

  it('accepts decimal immediate operands', () => {
    expect(validateAsm(parseAsm('ADD A,#12'), spec)).toEqual([]);
  });

  it('accepts H-suffix register addresses', () => {
    expect(validateAsm(parseAsm('ADD A,10H\nBSET 10H,5'), spec)).toEqual([]);
  });

  it('reports operand shape mismatches for malformed ADD forms', () => {
    expect(diagnosticCodes('ADD 0x10,A')).toEqual(['OPERAND_SHAPE_MISMATCH']);
    expect(diagnosticCodes('ADD A')).toEqual(['OPERAND_SHAPE_MISMATCH']);
  });

  it('validates r8,b operands and reports bit range errors', () => {
    expect(validateAsm(parseAsm('BSET 0x10,5'), spec)).toEqual([]);
    expect(diagnosticCodes('BSET 0x10,8')).toEqual(['OPERAND_OUT_OF_RANGE']);
  });

  it('resolves register names for r8 operands', () => {
    expect(validateAsm(parseAsm('BSET SCK_PS,5'), spec)).toEqual([]);
  });

  it('reports unknown register names used in r8 slots', () => {
    expect(diagnosticCodes('BSET NOT_A_REGISTER,5')).toEqual(['UNKNOWN_REGISTER']);
  });

  it('resolves labels for k10 operands', () => {
    expect(validateAsm(parseAsm('loop:\nJMP loop'), spec)).toEqual([]);
  });

  it('reports unknown labels used in k10 operands', () => {
    expect(diagnosticCodes('JMP missing')).toEqual(['UNKNOWN_LABEL']);
  });

  it('uses asmSyntax to accept MOV immediate form despite the current operands metadata', () => {
    expect(validateAsm(parseAsm('MOV A,#0x12'), spec)).toEqual([]);
  });
});
