import { describe, expect, it } from 'vitest';
import {
  compileSpec,
  normalizeAddress,
  normalizeInstructionRow,
  normalizeRegisterRow
} from '../../src/shared/spec/SpecCompiler';

describe('SpecCompiler', () => {
  it('normalizes address text from common company spreadsheet formats', () => {
    expect(normalizeAddress('10H')).toBe(0x10);
    expect(normalizeAddress('1AH')).toBe(0x1a);
    expect(normalizeAddress('0x24')).toBe(0x24);
  });

  it('normalizes instruction rows into instruction forms', () => {
    expect(
      normalizeInstructionRow({
        mnemonic: ' jmp ',
        asmSyntax: 'JMP K',
        operands: 'k10',
        opcodePattern: '1100 00kk kkkkkkkk',
        maskHex: 'fc00h',
        valueHex: '0xc000',
        cycles: '2',
        flagsAffected: 'z, c',
        notes: 'PC -> K'
      })
    ).toEqual({
      mnemonic: 'JMP',
      asmSyntax: 'JMP K',
      operands: 'k10',
      wordBits: 16,
      opcodePattern: '1100 00kk kkkkkkkk',
      maskHex: '0xFC00',
      valueHex: '0xC000',
      cycles: 2,
      cyclesRaw: '2',
      flagsAffected: ['Z', 'C'],
      notes: 'PC -> K'
    });
  });

  it('preserves variable cycle text while keeping the numeric compatibility value', () => {
    expect(
      normalizeInstructionRow({
        mnemonic: 'SBCR',
        asmSyntax: 'SBCR R,b',
        operands: 'r8,b',
        opcodePattern: '0001 10rr rrrr rbbb',
        maskHex: 'f800h',
        valueHex: '1800h',
        cycles: '1or2'
      })
    ).toMatchObject({
      cycles: 1,
      cyclesRaw: '1or2'
    });
  });

  it('normalizes known asm syntax typos from the source spreadsheet', () => {
    const baseRow = {
      mnemonic: 'XOR',
      operands: 'k8',
      opcodePattern: '0010 10kk kkkkkkkk',
      maskHex: 'fc00h',
      valueHex: '2800h',
      cycles: '1'
    };

    expect(normalizeInstructionRow({ ...baseRow, asmSyntax: 'XOR A.#K' }).asmSyntax).toBe('XOR A,#K');
    const bitRow = {
      ...baseRow,
      operands: 'r8,b',
      opcodePattern: '0111 1bbb rrrrrrrr',
      maskHex: 'f800h',
      valueHex: '7800h'
    };

    expect(normalizeInstructionRow({ ...bitRow, mnemonic: 'BTSZ', asmSyntax: 'BTSZ,R,b' }).asmSyntax).toBe('BTSZ R,b');
    expect(
      normalizeInstructionRow({
        ...bitRow,
        mnemonic: 'BTSNZ',
        asmSyntax: 'BTSNZ,R,b',
        opcodePattern: '1001 1bbb rrrrrrrr',
        valueHex: '9800h'
      }).asmSyntax
    ).toBe('BTSNZ R,b');
  });

  it('normalizes register rows into register specs with named bits only', () => {
    expect(
      normalizeRegisterRow({
        name: ' SCK_PS ',
        address: '10H',
        kind: 'sfr',
        resetValue: '34h',
        bit7: '-',
        bit6: '',
        bit5: 'SCKHL: OSC high/low frequency select',
        bit4: 'EX:OSC enable without a separator space',
        bit3: 'SCKPS[3:0]\uff1asystem clock frequency select',
        bit2: '-',
        bit1: null,
        bit0: 'PS0',
        notes: 'clock register'
      })
    ).toEqual({
      name: 'SCK_PS',
      address: 0x10,
      addressText: '10H',
      kind: 'SFR',
      resetValue: '0x34',
      bits: [
        { bit: 5, name: 'SCKHL', description: 'OSC high/low frequency select' },
        { bit: 4, name: 'EX', description: 'OSC enable without a separator space' },
        { bit: 3, name: 'SCKPS[3:0]', description: 'system clock frequency select' },
        { bit: 0, name: 'PS0', description: '' }
      ],
      notes: ['clock register']
    });
  });

  it('splits register bit descriptions only on separators outside bit ranges', () => {
    const baseRow = {
      name: 'SCK_PS',
      address: '10H',
      kind: 'SFR',
      resetValue: '34h'
    };

    expect(normalizeRegisterRow({ ...baseRow, bit5: 'SCKHL:OSC' }).bits).toContainEqual({
      bit: 5,
      name: 'SCKHL',
      description: 'OSC'
    });
    expect(normalizeRegisterRow({ ...baseRow, bit5: 'SCKHL: OSC' }).bits).toContainEqual({
      bit: 5,
      name: 'SCKHL',
      description: 'OSC'
    });
    expect(normalizeRegisterRow({ ...baseRow, bit5: 'SCKPS[3:0]\uff1asystem clock frequency select' }).bits).toContainEqual({
      bit: 5,
      name: 'SCKPS[3:0]',
      description: 'system clock frequency select'
    });
  });

  it('compiles normalized rows into the HK64S8x chip spec shell', () => {
    const spec = compileSpec({
      instructionRows: [
        {
          mnemonic: 'NOP',
          asmSyntax: 'NOP',
          operands: '',
          opcodePattern: '0000 0000 00000000',
          maskHex: 'ffffh',
          valueHex: '0000h',
          cycles: 1
        }
      ],
      registerRows: [
        {
          name: 'SCK_PS',
          address: '10H',
          kind: 'SFR',
          resetValue: '34H',
          bit5: 'SCKHL',
          bit4: 'EX'
        }
      ],
      instructionSource: 'instruction_set.xlsx',
      registerSource: 'register_set.xlsx',
      documentSource: 'HK64S8x_spec.docx'
    });

    expect(spec).toMatchObject({
      chipId: 'HK64S8x',
      displayName: 'HK64S8x',
      version: '0.1',
      instructionSource: 'instruction_set.xlsx',
      registerSource: 'register_set.xlsx',
      documentSource: 'HK64S8x_spec.docx',
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
    });
    expect(spec.instructions).toHaveLength(1);
    expect(spec.registers).toHaveLength(1);
  });

  it('uses the correct default document source without mojibake', () => {
    const spec = compileSpec({
      instructionRows: [
        {
          mnemonic: 'NOP',
          asmSyntax: 'NOP',
          operands: '',
          opcodePattern: '0000 0000 00000000',
          maskHex: 'ffffh',
          valueHex: '0000h',
          cycles: 1
        }
      ],
      registerRows: [
        {
          name: 'SCK_PS',
          address: '10H',
          kind: 'SFR',
          resetValue: '34H'
        }
      ]
    });

    expect(spec.documentSource).toBe('HK64S8x_\u89c4\u683c\u4e66 V0.1.docx');
  });

  it('rejects immediate-syntax instruction whose operands are mislabeled (e.g. MOV A,#K as r8)', () => {
    expect(() =>
      normalizeInstructionRow({
        mnemonic: 'MOV',
        asmSyntax: 'MOV A,#K',
        operands: 'r8',
        opcodePattern: '0111 0010 kkkkkkkk',
        maskHex: 'ff00h',
        valueHex: '7200h',
        cycles: '1'
      })
    ).toThrow(/immediate syntax/i);
  });

  it('accepts the corrected immediate instruction operands (k8)', () => {
    expect(
      normalizeInstructionRow({
        mnemonic: 'MOV',
        asmSyntax: 'MOV A,#K',
        operands: 'k8',
        opcodePattern: '0111 0010 kkkkkkkk',
        maskHex: 'ff00h',
        valueHex: '7200h',
        cycles: '1'
      }).operands
    ).toBe('k8');
  });

  it('rejects instruction whose opcode pattern variables disagree with operands type', () => {
    expect(() =>
      normalizeInstructionRow({
        mnemonic: 'MOV',
        asmSyntax: 'MOV A,R',
        operands: 'r8',
        opcodePattern: '0111 0010 kkkkkkkk',
        maskHex: 'ff00h',
        valueHex: '7000h',
        cycles: '1'
      })
    ).toThrow(/opcode pattern/i);
  });
});
