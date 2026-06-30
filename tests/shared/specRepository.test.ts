import { describe, expect, it } from 'vitest';
import { BuiltInSpecRepository } from '../../src/shared/spec/BuiltInSpecRepository';

describe('BuiltInSpecRepository', () => {
  it('loads HK64S8x as a built-in chip platform', () => {
    const repo = new BuiltInSpecRepository();
    const spec = repo.getByChipId('HK64S8x');

    expect(spec.chipId).toBe('HK64S8x');
    expect(spec.version).toBe('0.1');
    expect(spec.documentSource).toBe('HK64S8x_\u89c4\u683c\u4e66 V0.1.docx');
    expect(spec.instructions).toHaveLength(65);
    expect(spec.registers).toHaveLength(96);
    expect(spec.instructions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cycles: 1,
          cyclesRaw: '1or2'
        })
      ])
    );

    expect(spec.instructions.map((instruction) => instruction.mnemonic)).toEqual(
      expect.arrayContaining(['NOP', 'JMP', 'CLRWDT'])
    );
    expect(spec.instructions.find((instruction) => instruction.mnemonic === 'JMP')).toMatchObject({
      asmSyntax: 'JMP K',
      operands: 'k10',
      maskHex: '0xFC00',
      valueHex: '0xC000'
    });

    expect(spec.registers.find((register) => register.name === 'SCK_PS')).toMatchObject({
      address: 0x10,
      kind: 'SFR',
      bits: expect.arrayContaining([
        expect.objectContaining({ name: 'SCKHL' }),
        expect.objectContaining({ name: 'EX' })
      ])
    });

    expect(spec.vectors).toEqual({
      reset: 0x000,
      interrupt: 0x008
    });
    expect(spec.memory).toEqual(
      expect.arrayContaining([
        { name: 'SFR', start: 0x00, end: 0x7f },
        { name: 'RAM', start: 0x80, end: 0xbf }
      ])
    );
  });

  it('returns isolated built-in specs for each lookup', () => {
    const repo = new BuiltInSpecRepository();

    const firstRead = repo.getByChipId('HK64S8x');
    firstRead.instructions[0].mnemonic = 'BROKEN';
    firstRead.registers[0].bits[0].name = 'BROKEN_BIT';

    const secondRead = repo.getByChipId('HK64S8x');

    expect(secondRead.instructions.map((instruction) => instruction.mnemonic)).toEqual(
      expect.arrayContaining(['NOP', 'JMP', 'CLRWDT'])
    );
    expect(secondRead.registers.find((register) => register.name === 'SCK_PS')?.bits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'SCKHL' }),
        expect.objectContaining({ name: 'EX' })
      ])
    );
  });

  it('rejects unknown chip platforms', () => {
    const repo = new BuiltInSpecRepository();

    expect(() => repo.getByChipId('UNKNOWN_CHIP')).toThrow(
      'Unsupported chip platform: UNKNOWN_CHIP'
    );
  });
});
