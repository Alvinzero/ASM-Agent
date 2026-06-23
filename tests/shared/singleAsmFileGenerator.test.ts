import { describe, expect, it } from 'vitest';

import { parseAsm } from '../../src/shared/asm/AsmParser';
import { SingleAsmFileGenerator } from '../../src/shared/asm/SingleAsmFileGenerator';
import { validateAsm } from '../../src/shared/asm/AsmValidator';
import type { GenerationPlan } from '../../src/shared/agent/GenerationPlanner';
import { BuiltInSpecRepository } from '../../src/shared/spec/BuiltInSpecRepository';

const spec = new BuiltInSpecRepository().getByChipId('HK8S8100X');

const gpioPlan: GenerationPlan = {
  summary: 'Generate a GPIO output ASM file.',
  chipId: 'HK8S8100X',
  features: ['GPIO'],
  files: ['main.asm'],
  usesInterrupt: false,
  requiredRegisters: ['PA_PIO', 'PA_OE'],
  assumptions: []
};

describe('SingleAsmFileGenerator', () => {
  it('emits one validated main.asm file using only built-in instructions and registers', () => {
    const file = new SingleAsmFileGenerator().generate({
      requirement: 'Generate HK8S8100X GPIO output on PA0.',
      plan: gpioPlan,
      spec
    });

    expect(file.path).toBe('main.asm');
    expect(file.content).toContain('MOV PA_OE,A');
    expect(file.content).toContain('MOV PA_PIO,A');
    expect(file.content).not.toMatch(/\bP0DIR\b|\bP0\b/);
    expect(validateAsm(parseAsm(file.content), spec)).toEqual([]);
  });

  it('uses the requested asm filename after sanitizing it to a flat asm file', () => {
    const file = new SingleAsmFileGenerator().generate({
      requirement: 'Generate HK8S8100X GPIO output on PA0.',
      plan: gpioPlan,
      spec,
      fileName: '../demo file.asm'
    });

    expect(file.path).toBe('demo-file.asm');
    expect(validateAsm(parseAsm(file.content), spec)).toEqual([]);
  });
});
