import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentService } from '../../src/shared/agent/AgentService';
import type { GenerationPlan, PlanResult } from '../../src/shared/agent/GenerationPlanner';
import { parseAsm } from '../../src/shared/asm/AsmParser';
import { ProjectGenerator } from '../../src/shared/asm/ProjectGenerator';
import { validateAsm } from '../../src/shared/asm/AsmValidator';
import { exportProject } from '../../src/shared/project/ProjectExporter';
import type { GeneratedProject } from '../../src/shared/project/ProjectTypes';
import { BuiltInSpecRepository } from '../../src/shared/spec/BuiltInSpecRepository';

const repository = new BuiltInSpecRepository();
const generator = new ProjectGenerator();

function expectReady(result: PlanResult): GenerationPlan {
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error('Expected ready plan');
  return result.plan;
}

async function createPlan(requirement: string): Promise<GenerationPlan> {
  return expectReady(
    await new AgentService(repository).createPlan({
      chipId: 'HK8S8100X',
      requirement
    })
  );
}

function generateProject(plan: GenerationPlan, projectName = 'acceptance-demo'): GeneratedProject {
  return generator.generate({
    projectName,
    requirement: 'acceptance test requirement',
    plan,
    spec: repository.getByChipId('HK8S8100X')
  });
}

function filePaths(project: GeneratedProject): string[] {
  return project.files.map((file) => file.path);
}

function fileContent(project: GeneratedProject, filePath: string): string {
  const file = project.files.find((candidate) => candidate.path === filePath);
  if (!file) throw new Error(`Expected generated file: ${filePath}`);
  return file.content;
}

describe('ASM Agent MVP acceptance cases', () => {
  const tempRoots: string[] = [];

  function makeTempRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asm-agent-acceptance-'));
    tempRoots.push(root);
    return root;
  }

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps built-in HK8S8100X spec reads isolated from caller mutation', () => {
    const firstRead = repository.getByChipId('HK8S8100X');
    firstRead.chipId = 'MUTATED';
    firstRead.instructions[0].mnemonic = 'MUTATED';
    firstRead.registers[0].name = 'MUTATED';

    const secondRead = repository.getByChipId('HK8S8100X');

    expect(secondRead.chipId).toBe('HK8S8100X');
    expect(secondRead.instructions[0].mnemonic).not.toBe('MUTATED');
    expect(secondRead.registers[0].name).not.toBe('MUTATED');
  });

  it('plans a GPIO-only PA0 request without Timer0, WDT, or interrupt files', async () => {
    const plan = await createPlan('Generate a GPIO output project that toggles PA0.');

    expect(plan.features).toEqual(['GPIO']);
    expect(plan.usesInterrupt).toBe(false);
    expect(plan.files).toEqual(expect.arrayContaining(['src/gpio.asm']));
    expect(plan.files).not.toEqual(expect.arrayContaining(['startup/interrupt.asm', 'src/timer0.asm', 'src/wdt.asm']));
    expect(plan.requiredRegisters).toContain('PA_PIO');
    expect(plan.requiredRegisters).not.toEqual(expect.arrayContaining(['T0_PS', 'WDT_PS', 'IW1E']));
  });

  it('plans a WDT-only service request without GPIO or Timer0 registers', async () => {
    const plan = await createPlan('Generate a WDT service routine that periodically clears the watchdog.');

    expect(plan.features).toEqual(['WDT']);
    expect(plan.files).toEqual(expect.arrayContaining(['src/wdt.asm']));
    expect(plan.files).not.toEqual(expect.arrayContaining(['src/gpio.asm', 'src/timer0.asm']));
    expect(plan.requiredRegisters).toContain('WDT_PS');
    expect(plan.requiredRegisters).not.toEqual(expect.arrayContaining(['PA_PIO', 'T0_PS']));
  });

  it('deduplicates files and registers for repeated mixed natural-language requirements', async () => {
    const plan = await createPlan(
      'Timer0 Timer0 GPIO GPIO PA0 interrupt IRQ WDT WDT using 4MHz OSC and 1:64 prescaler.'
    );

    expect(plan.features).toEqual(expect.arrayContaining(['Timer0', 'GPIO', 'Interrupt', 'WDT']));
    expect(new Set(plan.files).size).toBe(plan.files.length);
    expect(new Set(plan.requiredRegisters).size).toBe(plan.requiredRegisters.length);
  });

  it('generates a GPIO-only project without unused interrupt, Timer0, or WDT ASM modules', async () => {
    const project = generateProject(await createPlan('Generate GPIO output on PA0.'));
    const paths = filePaths(project);

    expect(paths).toEqual(expect.arrayContaining(['startup/reset.asm', 'src/main.asm', 'src/gpio.asm']));
    expect(paths).not.toEqual(
      expect.arrayContaining(['startup/interrupt.asm', 'src/timer0.asm', 'src/wdt.asm'])
    );
    expect(fileContent(project, 'src/main.asm')).toContain('CALL gpio_init');
  });

  it('generates mixed-feature ASM accepted by the built-in parser and validator', async () => {
    const plan = await createPlan('Timer0 GPIO PA0 interrupt WDT using 4MHz OSC and 1:64 prescaler.');
    const project = generateProject(plan);
    const asmSource = project.files
      .filter((file) => file.path.endsWith('.asm'))
      .map((file) => file.content)
      .join('\n');

    expect(validateAsm(parseAsm(asmSource), repository.getByChipId('HK8S8100X'))).toEqual([]);
    expect(fileContent(project, 'src/main.asm')).toContain('CALL gpio_init');
    expect(fileContent(project, 'src/main.asm')).toContain('CALL timer0_init');
    expect(fileContent(project, 'src/main.asm')).toContain('CALL wdt_service');
  });

  it('lists only emitted ASM modules in the generated static-check config', async () => {
    const project = generateProject(await createPlan('Generate GPIO output on PA0.'));
    const staticCheck = JSON.parse(fileContent(project, 'tools/asm_static_check.json')) as {
      asmFiles: string[];
    };

    expect(staticCheck.asmFiles).toEqual(['startup/reset.asm', 'src/main.asm', 'src/gpio.asm']);
    expect(staticCheck.asmFiles).not.toEqual(
      expect.arrayContaining(['startup/interrupt.asm', 'src/timer0.asm', 'src/wdt.asm'])
    );
  });

  it('fails fast when an interrupt project is requested but the built-in spec lacks RETI', async () => {
    const plan = await createPlan('Generate GPIO PA0 interrupt project.');
    const specWithoutReti = {
      ...repository.getByChipId('HK8S8100X'),
      instructions: repository
        .getByChipId('HK8S8100X')
        .instructions.filter((instruction) => instruction.mnemonic !== 'RETI')
    };

    expect(() =>
      generator.generate({
        projectName: 'missing-reti',
        requirement: 'Generate GPIO PA0 interrupt project.',
        plan,
        spec: specWithoutReti
      })
    ).toThrow('Built-in spec is missing required instruction(s): RETI');
  });

  it('exports a generated project tree with nested ASM and documentation files', async () => {
    const project = generateProject(await createPlan('Generate GPIO output on PA0.'), 'exported-demo');
    const exportRoot = makeTempRoot();

    const projectDir = exportProject(exportRoot, project);

    expect(projectDir).toBe(path.join(exportRoot, 'exported-demo'));
    expect(fs.readFileSync(path.join(projectDir, 'src/main.asm'), 'utf8')).toContain('main_loop:');
    expect(fs.readFileSync(path.join(projectDir, 'docs/spec-compliance.md'), 'utf8')).toContain('HK8S8100X');
  });

  it('rejects generated file paths that traverse with Windows backslashes', () => {
    const exportRoot = makeTempRoot();

    expect(() =>
      exportProject(exportRoot, {
        projectName: 'unsafe-demo',
        files: [{ path: 'src\\..\\outside.asm', content: 'CLRWDT\n' }]
      })
    ).toThrow('Unsafe generated file path: src\\..\\outside.asm');
  });
});
