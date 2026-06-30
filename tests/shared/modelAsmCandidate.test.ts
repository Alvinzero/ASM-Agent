import { describe, expect, it } from 'vitest';

import { buildModelAsmGeneratedFile } from '../../src/shared/asm/ModelAsmCandidate';
import { BuiltInSpecRepository } from '../../src/shared/spec/BuiltInSpecRepository';

const spec = new BuiltInSpecRepository().getByChipId('HK64S8x');

describe('ModelAsmCandidate', () => {
  it('extracts a model ASM code block and returns a validated generated file', () => {
    const file = buildModelAsmGeneratedFile({
      modelResponse: ['模型说明不会进入文件。', '', '```asm', 'entry:', '  CLRWDT', '  JMP entry', '```'].join('\n'),
      spec
    });

    expect(file).toEqual({
      path: 'main.asm',
      content: ['entry:', '  CLRWDT', '  JMP entry', ''].join('\n')
    });
  });

  it('rejects a model ASM block that violates the JSON spec', () => {
    expect(() =>
      buildModelAsmGeneratedFile({
        modelResponse: ['```asm', 'entry:', '  MOV P1_DIR,A', '  JMP entry', '```'].join('\n'),
        spec
      })
    ).toThrow('ASM 质量闸失败：第 2 行 UNKNOWN_REGISTER：未知寄存器 P1_DIR');
  });

  it('rejects model responses without an ASM code block', () => {
    expect(() =>
      buildModelAsmGeneratedFile({
        modelResponse: '我会稍后提供代码。',
        spec
      })
    ).toThrow('模型没有返回可质检的 ASM 代码块。');
  });

  it('rejects PA blink ASM that keeps PA0 forced on through a computed mask', () => {
    const modelResponse = [
      '```asm',
      'INIT:',
      '  MOV A,#00H',
      '  MOV 34H,A',
      '  MOV A,#07H',
      '  MOV 35H,A',
      '  CLR 38H',
      '  CLR 82H',
      'MAIN_LOOP:',
      '  CLR 38H',
      '  MOV A,82H',
      '  MOV 80H,A',
      '  MOV A,#01H',
      '  OR A,80H',
      '  MOV 38H,A',
      '  CALL DELAY',
      '  INCR 82H',
      '  MOV A,82H',
      '  SE #04H',
      '  JMP MAIN_LOOP',
      '  JMP INIT',
      'DELAY:',
      '  NOP',
      '  RET',
      '```'
    ].join('\n');

    expect(() =>
      buildModelAsmGeneratedFile({
        modelResponse,
        requirement: '让 PA0 PA1 PA2 对应的彩灯间隔闪烁，间隔 20ms。',
        spec
      })
    ).toThrow('ASM 需求行为质检失败');
  });

  it('accepts PA blink ASM that writes explicit visible masks for every requested pin', () => {
    const file = buildModelAsmGeneratedFile({
      modelResponse: [
        '```asm',
        'INIT:',
        '  MOV A,#00H',
        '  MOV 34H,A',
        '  MOV A,#07H',
        '  MOV 35H,A',
        'MAIN_LOOP:',
        '  MOV A,#01H',
        '  MOV 38H,A',
        '  CALL DELAY',
        '  MOV A,#02H',
        '  MOV 38H,A',
        '  CALL DELAY',
        '  MOV A,#04H',
        '  MOV 38H,A',
        '  CALL DELAY',
        '  MOV A,#00H',
        '  MOV 38H,A',
        '  CALL DELAY',
        '  JMP MAIN_LOOP',
        'DELAY:',
        '  NOP',
        '  RET',
        '```'
      ].join('\n'),
      requirement: '让 PA0 PA1 PA2 对应的彩灯间隔闪烁，间隔 20ms。',
      spec
    });

    expect(file.content).toContain('MOV A,#01H');
    expect(file.content).toContain('MOV A,#02H');
    expect(file.content).toContain('MOV A,#04H');
  });

  it('rejects PA blink ASM that uses DECSZ for delay counters because it does not write back', () => {
    const modelResponse = [
      '```asm',
      'INIT:',
      '  MOV A,#00H',
      '  MOV 34H,A',
      '  MOV A,#07H',
      '  MOV 35H,A',
      'MAIN_LOOP:',
      '  MOV A,#01H',
      '  MOV 38H,A',
      '  CALL DELAY',
      '  MOV A,#02H',
      '  MOV 38H,A',
      '  CALL DELAY',
      '  MOV A,#04H',
      '  MOV 38H,A',
      '  CALL DELAY',
      '  JMP MAIN_LOOP',
      'DELAY:',
      '  MOV A,#FFH',
      '  MOV 81H,A',
      'DELAY_INNER:',
      '  DECSZ 81H',
      '  JMP DELAY_INNER',
      '  RET',
      '```'
    ].join('\n');

    expect(() =>
      buildModelAsmGeneratedFile({
        modelResponse,
        requirement: '让 PA0 PA1 PA2 对应的彩灯间隔闪烁，间隔 200ms。',
        spec
      })
    ).toThrow('DECSZ 不会把减 1 结果写回 RAM');
  });

  it('accepts PA blink ASM that uses DECSZR for delay counters', () => {
    const file = buildModelAsmGeneratedFile({
      modelResponse: [
        '```asm',
        'INIT:',
        '  MOV A,#00H',
        '  MOV 34H,A',
        '  MOV A,#07H',
        '  MOV 35H,A',
        'MAIN_LOOP:',
        '  MOV A,#01H',
        '  MOV 38H,A',
        '  CALL DELAY_200MS',
        '  MOV A,#02H',
        '  MOV 38H,A',
        '  CALL DELAY_200MS',
        '  MOV A,#04H',
        '  MOV 38H,A',
        '  CALL DELAY_200MS',
        '  MOV A,#00H',
        '  MOV 38H,A',
        '  CALL DELAY_200MS',
        '  JMP MAIN_LOOP',
        'DELAY_200MS:',
        '  MOV A,#08H',
        '  MOV 82H,A',
        'DELAY_L3:',
        '  MOV A,#FFH',
        '  MOV 80H,A',
        'DELAY_L2:',
        '  MOV A,#FFH',
        '  MOV 81H,A',
        'DELAY_L1:',
        '  DECSZR 81H',
        '  JMP DELAY_L1',
        '  DECSZR 80H',
        '  JMP DELAY_L2',
        '  DECSZR 82H',
        '  JMP DELAY_L3',
        '  RET',
        '```'
      ].join('\n'),
      requirement: '让 PA0 PA1 PA2 对应的彩灯间隔闪烁，间隔 200ms。',
      spec
    });

    expect(file.content).toContain('DECSZR 81H');
    expect(file.content).not.toContain('DECSZ 81H');
  });

  it('rejects PA blink ASM whose 16M software delay estimate is far longer than requested', () => {
    const modelResponse = [
      '```asm',
      'INIT:',
      '  MOV A,#00H',
      '  MOV 34H,A',
      '  MOV A,#25H',
      '  MOV 35H,A',
      'MAIN_LOOP:',
      '  MOV A,#01H',
      '  MOV 38H,A',
      '  CALL DELAY_500MS',
      '  MOV A,#04H',
      '  MOV 38H,A',
      '  CALL DELAY_500MS',
      '  MOV A,#20H',
      '  MOV 38H,A',
      '  CALL DELAY_500MS',
      '  JMP MAIN_LOOP',
      'DELAY_500MS:',
      '  MOV A,#7AH',
      '  MOV 82H,A',
      'DELAY_L3:',
      '  MOV A,#FFH',
      '  MOV 80H,A',
      'DELAY_L2:',
      '  MOV A,#FFH',
      '  MOV 81H,A',
      'DELAY_L1:',
      '  DECSZR 81H',
      '  JMP DELAY_L1',
      '  DECSZR 80H',
      '  JMP DELAY_L2',
      '  DECSZR 82H',
      '  JMP DELAY_L3',
      '  RET',
      '```'
    ].join('\n');

    expect(() =>
      buildModelAsmGeneratedFile({
        modelResponse,
        requirement: '主频16M，让 PA0 PA2 PA5 彩灯轮流闪烁，间隔500ms。',
        spec
      })
    ).toThrow('软件延时估算');
  });

  it('accepts PA blink ASM whose 16M software delay estimate is close to 500ms', () => {
    const file = buildModelAsmGeneratedFile({
      modelResponse: [
        '```asm',
        'INIT:',
        '  MOV A,#00H',
        '  MOV 34H,A',
        '  MOV A,#25H',
        '  MOV 35H,A',
        'MAIN_LOOP:',
        '  MOV A,#01H',
        '  MOV 38H,A',
        '  CALL DELAY_500MS',
        '  MOV A,#04H',
        '  MOV 38H,A',
        '  CALL DELAY_500MS',
        '  MOV A,#20H',
        '  MOV 38H,A',
        '  CALL DELAY_500MS',
        '  JMP MAIN_LOOP',
        'DELAY_500MS:',
        '  MOV A,#0AH',
        '  MOV 82H,A',
        'DELAY_L3:',
        '  MOV A,#FFH',
        '  MOV 80H,A',
        'DELAY_L2:',
        '  MOV A,#FFH',
        '  MOV 81H,A',
        'DELAY_L1:',
        '  DECSZR 81H',
        '  JMP DELAY_L1',
        '  DECSZR 80H',
        '  JMP DELAY_L2',
        '  DECSZR 82H',
        '  JMP DELAY_L3',
        '  RET',
        '```'
      ].join('\n'),
      requirement: '主频16M，让 PA0 PA2 PA5 彩灯轮流闪烁，间隔500ms。',
      spec
    });

    expect(file.content).toContain('MOV A,#0AH');
  });
});
