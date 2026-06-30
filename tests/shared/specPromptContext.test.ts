import { describe, expect, it } from 'vitest';

import { buildSpecPromptPayload, renderSpecPromptAttachment } from '../../src/shared/spec/SpecPromptContext';
import { BuiltInSpecRepository } from '../../src/shared/spec/BuiltInSpecRepository';

describe('SpecPromptContext', () => {
  it('builds a lossless prompt payload from the built-in JSON spec', () => {
    const spec = new BuiltInSpecRepository().getByChipId('HK64S8x');
    const payload = buildSpecPromptPayload(spec);

    expect(payload.chipId).toBe(spec.chipId);
    expect(payload.version).toBe(spec.version);
    expect(payload.sourcePath).toBe('src/shared/spec/hk64s8x.v0.1.json');
    expect(payload.integrity.checksum).toMatch(/^fnv1a32:[0-9a-f]{8}$/);
    expect(payload.integrity.instructions).toBe(spec.instructions.length);
    expect(payload.integrity.registers).toBe(spec.registers.length);
    expect(payload.instructions).toEqual(spec.instructions);
    expect(payload.registers).toEqual(spec.registers);
    expect(payload.memory).toEqual(spec.memory);
    expect(payload.vectors).toEqual(spec.vectors);
    expect(payload.asmSyntax).toEqual(spec.asmSyntax);
  });

  it('renders model-facing instructions that forbid using conversation memory as the spec source', () => {
    const spec = new BuiltInSpecRepository().getByChipId('HK64S8x');
    const attachment = renderSpecPromptAttachment(spec);

    expect(attachment).toContain('SPEC_DRIVEN_ASM_CONTEXT');
    expect(attachment).toContain('Do not rely on conversation memory as the chip specification');
    expect(attachment).toContain('numeric register, jump, and call addresses must use the ASMC H suffix');
    expect(attachment).toContain('do not use pseudo instructions such as ORG, END, EQU, DB, DS');
    expect(attachment).toContain('the R token in instruction syntax is an operand placeholder');
    expect(attachment).toContain('Do not invent R0, R1, R2');
    expect(attachment).toContain('for example 80H');
    expect(attachment).toContain('do not output 8051-style instructions or flags such as SETB, DJNZ, JB');
    expect(attachment).toContain('use DECSZR or INCSZR for software delay counters');
    expect(attachment).toContain('Do not use DECSZ or INCSZ as RAM delay-loop counters');
    expect(attachment).toContain('At 16MHz, a three-level DECSZR delay using #0AH/#FFH/#FFH');
    expect(attachment).toContain('#7AH/#FFH/#FFH is far longer than 500ms');
    expect(attachment).toContain('"chipId":"HK64S8x"');
    expect(attachment).toContain('"asmSyntax":"JMP K"');
    expect(attachment).toContain('"name":"SCK_PS"');
    expect(attachment).toContain('"registers":96');
  });
});
