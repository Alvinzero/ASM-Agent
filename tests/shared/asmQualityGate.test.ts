import { describe, expect, it } from 'vitest';

import { assertAsmSourcePassesQualityGate, validateAsmSourceQuality } from '../../src/shared/asm/AsmQualityGate';
import { BuiltInSpecRepository } from '../../src/shared/spec/BuiltInSpecRepository';
import { formatAsmFileDiagnostic, resolveAsmFileArgument } from '../../scripts/validateAsm';

const spec = new BuiltInSpecRepository().getByChipId('HK64S8x');

describe('AsmQualityGate', () => {
  it('accepts ASM that passes the built-in specification validator', () => {
    const source = ['main_loop:', '  CLRWDT', '  JMP main_loop'].join('\n');

    expect(validateAsmSourceQuality(source, spec)).toEqual([]);
    expect(() => assertAsmSourcePassesQualityGate(source, spec)).not.toThrow();
  });

  it('rejects generated ASM that uses registers absent from the JSON spec', () => {
    const source = ['main_loop:', '  MOV P1_DIR,A', '  JMP main_loop'].join('\n');

    expect(validateAsmSourceQuality(source, spec)).toEqual([
      expect.objectContaining({
        code: 'UNKNOWN_REGISTER',
        message: 'Unknown register: P1_DIR'
      })
    ]);
    expect(() => assertAsmSourcePassesQualityGate(source, spec)).toThrow(
      'ASM 质量闸失败：第 2 行 UNKNOWN_REGISTER：未知寄存器 P1_DIR'
    );
  });

  it('formats unknown instruction diagnostics in Chinese for user-facing errors', () => {
    const source = ['ORG 0x000', 'main_loop:', '  CLRWDT', '  JMP main_loop', 'END'].join('\n');

    expect(() => assertAsmSourcePassesQualityGate(source, spec)).toThrow(
      'ASM 质量闸失败：第 1 行 UNKNOWN_INSTRUCTION：未知指令 ORG；第 5 行 UNKNOWN_INSTRUCTION：未知指令 END'
    );
  });

  it('rejects 8051-style dialect tokens before they leak into user-facing HK64S8x ASM', () => {
    const source = [
      'i2c_send_1:',
      '  SETB 0E6H',
      '  DJNZ R0,i2c_send_1',
      '  JB CY,i2c_send_1',
      '  ORL A,#01H'
    ].join('\n');

    expect(() => assertAsmSourcePassesQualityGate(source, spec)).toThrow(
      'ASM 质量闸失败：第 2 行 DIALECT_MISMATCH：检测到疑似 8051 方言指令 SETB；HK64S8x 成品 ASM 禁止使用 8051/兼容 MCU 的指令、标志位或寄存器写法；第 3 行 DIALECT_MISMATCH：检测到疑似 8051 方言指令 DJNZ；HK64S8x 成品 ASM 禁止使用 8051/兼容 MCU 的指令、标志位或寄存器写法；第 3 行 DIALECT_MISMATCH：检测到疑似 8051 方言寄存器 R0；请改用 JSON 规范允许的 RAM H 地址，例如 80H；第 4 行 DIALECT_MISMATCH：检测到疑似 8051 方言指令 JB；HK64S8x 成品 ASM 禁止使用 8051/兼容 MCU 的指令、标志位或寄存器写法；第 4 行 DIALECT_MISMATCH：检测到疑似 8051 方言标志位 CY；请改用 HK64S8x 规范中真实存在的寄存器、位字段或显式跳转条件；第 5 行 DIALECT_MISMATCH：检测到疑似 8051 方言指令 ORL；HK64S8x 成品 ASM 禁止使用 8051/兼容 MCU 的指令、标志位或寄存器写法'
    );
  });

  it('explains ASMC H-suffix address requirements in Chinese', () => {
    const source = ['main_loop:', '  MOV 38,A', '  CALL 46'].join('\n');

    expect(() => assertAsmSourcePassesQualityGate(source, spec)).toThrow(
      'ASM 质量闸失败：第 2 行 OPERAND_SHAPE_MISMATCH：寄存器地址必须使用 H 后缀，例如 10H：38；第 3 行 OPERAND_SHAPE_MISMATCH：跳转或调用地址必须使用 H 后缀，例如 20H：46'
    );
  });

  it('resolves the ASM file argument after the npm run separator', () => {
    expect(resolveAsmFileArgument(['--', '/tmp/main.asm'])).toBe('/tmp/main.asm');
    expect(resolveAsmFileArgument(['relative.asm'])).toBe('relative.asm');
  });

  it('formats file-level validation diagnostics in Chinese', () => {
    expect(
      formatAsmFileDiagnostic('/tmp/main.asm', {
        severity: 'error',
        code: 'OPERAND_SHAPE_MISMATCH',
        lineNumber: 2,
        message: 'Register address must use H suffix: 38'
      })
    ).toBe('/tmp/main.asm：第 2 行 OPERAND_SHAPE_MISMATCH：寄存器地址必须使用 H 后缀，例如 10H：38');
  });
});
