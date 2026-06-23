import { describe, expect, it } from 'vitest';
import { parseAsm } from '../../src/shared/asm/AsmParser';
import { validateAsm } from '../../src/shared/asm/AsmValidator';
import { ProjectGenerator } from '../../src/shared/asm/ProjectGenerator';
import type { GenerationPlan } from '../../src/shared/agent/GenerationPlanner';
import { BuiltInSpecRepository } from '../../src/shared/spec/BuiltInSpecRepository';

const spec = new BuiltInSpecRepository().getByChipId('HK8S8100X');

const timerGpioInterruptPlan: GenerationPlan = {
  summary: 'Generate a Timer0 interrupt GPIO ASM project for HK8S8100X.',
  chipId: 'HK8S8100X',
  features: ['Timer0', 'GPIO', 'Interrupt', 'WDT'],
  files: [
    'startup/reset.asm',
    'startup/interrupt.asm',
    'src/main.asm',
    'src/gpio.asm',
    'src/timer0.asm',
    'include/registers.inc',
    'docs/spec-compliance.md'
  ],
  usesInterrupt: true,
  requiredRegisters: ['T0_PS', 'PA_PIO'],
  assumptions: [
    'Timer0 and GPIO register writes require manual confirmation against the built-in spec.'
  ]
};

function generateProject() {
  return new ProjectGenerator().generate({
    projectName: 'timer0-gpio-interrupt',
    requirement: 'Generate Timer0 interrupt GPIO ASM project.',
    plan: timerGpioInterruptPlan,
    spec
  });
}

describe('ProjectGenerator', () => {
  it('generates the core Timer0 GPIO interrupt project tree and spec compliance docs', () => {
    const project = generateProject();
    const paths = project.files.map((file) => file.path);
    const specCompliance = project.files.find((file) => file.path === 'docs/spec-compliance.md');

    expect(project.projectName).toBe('timer0-gpio-interrupt');
    expect(paths).toEqual(
      expect.arrayContaining([
        'startup/reset.asm',
        'startup/interrupt.asm',
        'src/main.asm',
        'src/gpio.asm',
        'src/timer0.asm',
        'include/registers.inc',
        'docs/requirements.md',
        'docs/generation-plan.md',
        'docs/spec-compliance.md',
        'docs/self-check-report.md',
        'README.md',
        '.gitignore'
      ])
    );
    expect(specCompliance?.content).toContain('HK8S8100X');
  });

  it('emits only safe relative paths and newline-terminated file contents', () => {
    const project = generateProject();
    const paths = project.files.map((file) => file.path);

    for (const file of project.files) {
      expect(file.path).not.toMatch(/^[A-Za-z]:[\\/]/);
      expect(file.path).not.toMatch(/^[/\\]/);
      expect(file.path.split(/[\\/]/)).not.toContain('..');
      expect(file.content.endsWith('\n')).toBe(true);
    }

    expect(new Set(paths).size).toBe(paths.length);
  });

  it('generates ASM files accepted by the built-in parser and validator', () => {
    const project = generateProject();
    const asmSource = project.files
      .filter((file) => file.path.endsWith('.asm'))
      .map((file) => file.content)
      .join('\n');

    expect(validateAsm(parseAsm(asmSource), spec)).toEqual([]);
  });

  it('uses only built-in instruction mnemonics in ASM files', () => {
    const project = generateProject();
    const builtInMnemonics = new Set(
      spec.instructions.map((instruction) => instruction.mnemonic.toUpperCase())
    );
    const asmSource = project.files
      .filter((file) => file.path.endsWith('.asm'))
      .map((file) => file.content)
      .join('\n');
    const program = parseAsm(asmSource);
    const emittedMnemonics = program.lines
      .filter((line) => line.kind === 'instruction')
      .map((line) => line.mnemonic);

    expect(emittedMnemonics.length).toBeGreaterThan(0);
    expect(emittedMnemonics.every((mnemonic) => builtInMnemonics.has(mnemonic))).toBe(true);
  });

  it('generates register constants from the built-in register table', () => {
    const project = generateProject();
    const registers = project.files.find((file) => file.path === 'include/registers.inc');
    const t0Ps = spec.registers.find((register) => register.name === 'T0_PS');
    const paPio = spec.registers.find((register) => register.name === 'PA_PIO');

    expect(t0Ps).toBeDefined();
    expect(paPio).toBeDefined();
    expect(registers?.content).toContain(`T0_PS EQU 0x${t0Ps?.address.toString(16).toUpperCase()}`);
    expect(registers?.content).toContain(`PA_PIO EQU 0x${paPio?.address.toString(16).toUpperCase()}`);
  });

  it('sanitizes bitfield constant names and preserves original bitfield comments', () => {
    const project = generateProject();
    const bitfields = project.files.find((file) => file.path === 'include/bitfields.inc');
    if (!bitfields) throw new Error('Expected include/bitfields.inc');

    const constantNames = bitfields.content
      .split(/\r?\n/)
      .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+EQU\s+/)?.[1])
      .filter((name): name is string => Boolean(name));

    expect(constantNames.length).toBeGreaterThan(0);
    expect(constantNames.every((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))).toBe(true);
    expect(new Set(constantNames).size).toBe(constantNames.length);
    expect(bitfields.content).toContain('T0_PS_T0PS_3_0 EQU');
    expect(bitfields.content).toContain('; original bitfield: T0PS[3:0]');
  });

  it('adds stable suffixes when sanitized bitfield names collide', () => {
    const duplicateSpec = {
      ...spec,
      registers: [
        {
          ...spec.registers[0],
          name: '123',
          bits: [
            { bit: 0, name: 'A-B', description: 'first duplicate' },
            { bit: 1, name: 'A B', description: 'second duplicate' }
          ]
        }
      ]
    };
    const project = new ProjectGenerator().generate({
      projectName: 'duplicate-bitfields',
      requirement: 'Generate duplicate bitfield constants.',
      plan: timerGpioInterruptPlan,
      spec: duplicateSpec
    });
    const bitfields = project.files.find((file) => file.path === 'include/bitfields.inc');

    expect(bitfields?.content).toContain('BIT_123_A_B EQU 0x0 ; original bitfield: A-B');
    expect(bitfields?.content).toContain('BIT_123_A_B_2 EQU 0x1 ; original bitfield: A B');
  });

  it('does not emit compile, simulation, burn, or flash commands in generated tooling config', () => {
    const project = generateProject();
    const toolConfigs = project.files.filter(
      (file) => file.path === '.vscode/tasks.json' || file.path.startsWith('tools/')
    );
    const combinedTooling = toolConfigs.map((file) => file.content).join('\n').toLowerCase();

    expect(toolConfigs.length).toBeGreaterThan(0);
    expect(combinedTooling).not.toMatch(/\b(build|compile|simulate|simulation|burn|flash)\b/);
  });

  it('marks static check config as intended checks that have not been executed', () => {
    const project = generateProject();
    const tasks = project.files.find((file) => file.path === '.vscode/tasks.json');
    const staticCheck = project.files.find((file) => file.path === 'tools/asm_static_check.json');
    if (!tasks || !staticCheck) throw new Error('Expected generated tooling config');

    expect(JSON.parse(tasks.content).tasks[0].label).toBe('Print ASM reports');
    expect(JSON.parse(staticCheck.content)).toMatchObject({
      status: 'not-executed',
      intendedChecks: expect.arrayContaining(['parse ASM files'])
    });
    expect(JSON.parse(staticCheck.content)).not.toHaveProperty('checks');
  });

  it('states MVP non-claims without presenting compile, simulation, burn, flash, or hardware verification as completed', () => {
    const project = generateProject();
    const readme = project.files.find((file) => file.path === 'README.md');
    const selfCheck = project.files.find((file) => file.path === 'docs/self-check-report.md');

    expect(readme?.content).toMatch(/does not claim compile, simulation, burn, flash, hardware verification/i);
    expect(selfCheck?.content).toMatch(/does not claim compile, simulation, burn, flash, hardware verification/i);
    expect(`${readme?.content}\n${selfCheck?.content}`).not.toMatch(
      /\b(compiled|simulated|burned|flashed|hardware verified)\b/i
    );
  });
});
