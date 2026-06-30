import type { ChipSpec } from '../spec/ChipSpec';
import type {
  GeneratedFile,
  GeneratedProject,
  GenerateProjectInput
} from '../project/ProjectTypes';
import { formatAsmDiagnosticForUser } from './AsmQualityGate';
import { parseAsm } from './AsmParser';
import { validateAsm } from './AsmValidator';

type FileDraft = {
  path: string;
  content: string;
};

const REQUIRED_BASE_INSTRUCTIONS = ['CLRWDT', 'JMP', 'CALL', 'RET'] as const;
const OPTIONAL_INTERRUPT_INSTRUCTIONS = ['RETI'] as const;

export class ProjectGenerator {
  generate(input: GenerateProjectInput): GeneratedProject {
    const features = new FeatureSet(input.plan.features);
    const instructionNames = new Set(
      input.spec.instructions.map((instruction) => instruction.mnemonic.toUpperCase())
    );

    requireInstructions(instructionNames, REQUIRED_BASE_INSTRUCTIONS);
    if (input.plan.usesInterrupt) requireInstructions(instructionNames, OPTIONAL_INTERRUPT_INSTRUCTIONS);

    const drafts: FileDraft[] = [];
    const emittedAsmInstructions = new Set<string>(['CLRWDT', 'CALL', 'JMP']);

    drafts.push({
      path: 'startup/reset.asm',
      content: renderResetAsm()
    });

    if (input.plan.usesInterrupt) {
      emittedAsmInstructions.add('RETI');
      drafts.push({
        path: 'startup/interrupt.asm',
        content: renderInterruptAsm()
      });
    }

    emittedAsmInstructions.add('RET');
    drafts.push({
      path: 'src/main.asm',
      content: renderMainAsm({
        hasGpio: features.has('GPIO'),
        hasTimer0: features.has('Timer0'),
        hasWdt: features.has('WDT')
      })
    });

    if (features.has('GPIO')) {
      drafts.push({
        path: 'src/gpio.asm',
        content: renderGpioAsm(input.plan.requiredRegisters)
      });
    }

    if (features.has('Timer0')) {
      drafts.push({
        path: 'src/timer0.asm',
        content: renderTimer0Asm(input.plan.requiredRegisters)
      });
    }

    if (features.has('WDT')) {
      drafts.push({
        path: 'src/wdt.asm',
        content: renderWdtAsm()
      });
    }

    drafts.push(
      {
        path: 'include/registers.inc',
        content: renderRegisters(input.spec)
      },
      {
        path: 'include/bitfields.inc',
        content: renderBitfields(input.spec)
      },
      {
        path: 'include/project_config.inc',
        content: renderProjectConfig(input)
      },
      {
        path: 'docs/requirements.md',
        content: renderRequirements(input)
      },
      {
        path: 'docs/generation-plan.md',
        content: renderGenerationPlan(input)
      },
      {
        path: 'docs/spec-compliance.md',
        content: renderSpecCompliance(input, Array.from(emittedAsmInstructions).sort())
      },
      {
        path: 'docs/self-check-report.md',
        content: renderSelfCheckReport(input)
      },
      {
        path: 'README.md',
        content: renderReadme(input)
      },
      {
        path: '.gitignore',
        content: renderGitignore()
      },
      {
        path: '.vscode/tasks.json',
        content: renderVscodeTasks()
      },
      {
        path: '.vscode/settings.json',
        content: renderVscodeSettings()
      },
      {
        path: '.vscode/extensions.json',
        content: renderVscodeExtensions()
      },
      {
        path: 'tools/asm_static_check.json',
        content: renderStaticCheckConfig(input)
      }
    );

    assertUniqueFilePaths(drafts);
    assertAsmDraftsValid(drafts, input.spec);

    return {
      projectName: input.projectName,
      files: drafts.map(toGeneratedFile)
    };
  }
}

class FeatureSet {
  private readonly features: Set<string>;

  constructor(features: string[]) {
    this.features = new Set(features.map((feature) => feature.toLowerCase()));
  }

  has(feature: string): boolean {
    return this.features.has(feature.toLowerCase());
  }
}

function renderResetAsm(): string {
  return lines([
    '; Reset entry generated from the built-in chip specification.',
    'reset_entry:',
    '  CLRWDT',
    '  CALL main_entry',
    '  JMP main_loop'
  ]);
}

function renderInterruptAsm(): string {
  return lines([
    '; Interrupt vector handler stub.',
    '; Add register save/restore and source dispatch after manual register review.',
    'interrupt_entry:',
    '  RETI'
  ]);
}

function renderMainAsm(options: { hasGpio: boolean; hasTimer0: boolean; hasWdt: boolean }): string {
  const body = [
    '; Main application skeleton.',
    'main_entry:'
  ];

  if (options.hasGpio) body.push('  CALL gpio_init');
  if (options.hasTimer0) body.push('  CALL timer0_init');
  if (options.hasWdt) body.push('  CALL wdt_service');

  body.push(
    'main_loop:',
    '  CLRWDT',
    '  JMP main_loop'
  );

  return lines(body);
}

function renderGpioAsm(requiredRegisters: string[]): string {
  return lines([
    '; GPIO initialization stub.',
    `; Required registers from plan: ${formatList(filterRegisters(requiredRegisters, ['PA_PIO']))}.`,
    '; Register writes are intentionally omitted until the plan is manually confirmed.',
    'gpio_init:',
    '  RET'
  ]);
}

function renderTimer0Asm(requiredRegisters: string[]): string {
  return lines([
    '; Timer0 initialization stub.',
    `; Required registers from plan: ${formatList(filterRegisters(requiredRegisters, ['T0_PS']))}.`,
    '; Timing preload and prescaler writes require manual confirmation against the specification.',
    'timer0_init:',
    '  RET'
  ]);
}

function renderWdtAsm(): string {
  return lines([
    '; WDT service routine.',
    '; Uses only the built-in CLRWDT instruction.',
    'wdt_service:',
    '  CLRWDT',
    '  RET'
  ]);
}

function renderRegisters(spec: ChipSpec): string {
  const directive = spec.asmSyntax.constantDirective;
  return lines([
    '; Register constants generated from the built-in chip specification.',
    `; Chip: ${spec.chipId}, spec version: ${spec.version}.`,
    ...spec.registers.map((register) => `${register.name} ${directive} ${formatHex(register.address)}`)
  ]);
}

function renderBitfields(spec: ChipSpec): string {
  const directive = spec.asmSyntax.constantDirective;
  const names = new UniqueNameAllocator();
  const bitConstants = spec.registers.flatMap((register) =>
    register.bits.map((bit) => {
      const rawName = `${register.name}_${bit.name}`;
      const constantName = names.allocate(sanitizeAsmConstantName(rawName));
      return `${constantName} ${directive} ${formatHex(bit.bit)} ; original bitfield: ${bit.name}`;
    })
  );

  return lines([
    '; Bitfield constants generated from the built-in chip specification.',
    `; Chip: ${spec.chipId}, spec version: ${spec.version}.`,
    ...bitConstants
  ]);
}

function renderProjectConfig(input: GenerateProjectInput): string {
  const directive = input.spec.asmSyntax.constantDirective;
  return lines([
    '; Project-level constants for static inspection.',
    `PROJECT_USES_INTERRUPT ${directive} ${input.plan.usesInterrupt ? '0x1' : '0x0'}`,
    `PROJECT_FEATURE_COUNT ${directive} ${formatHex(input.plan.features.length)}`
  ]);
}

function renderRequirements(input: GenerateProjectInput): string {
  return markdown([
    '# Requirements',
    '',
    `Project: ${input.projectName}`,
    '',
    '## Original Requirement',
    '',
    input.requirement || '(empty requirement)',
    '',
    '## Plan Summary',
    '',
    input.plan.summary
  ]);
}

function renderGenerationPlan(input: GenerateProjectInput): string {
  return markdown([
    '# Generation Plan',
    '',
    `Chip: ${input.plan.chipId}`,
    '',
    '## Features',
    '',
    ...bulletList(input.plan.features),
    '',
    '## Planned Files',
    '',
    ...bulletList(input.plan.files),
    '',
    '## Required Registers',
    '',
    ...bulletList(input.plan.requiredRegisters),
    '',
    '## Assumptions',
    '',
    ...bulletList(input.plan.assumptions)
  ]);
}

function renderSpecCompliance(input: GenerateProjectInput, emittedInstructions: string[]): string {
  return markdown([
    '# Specification Compliance',
    '',
    `Chip ID: ${input.spec.chipId}`,
    `Spec version: ${input.spec.version}`,
    '',
    '## Built-In Specification Use',
    '',
    'Generated ASM is constrained to the built-in company chip specification. No user-imported chip specification is required or exposed by this project generator.',
    '',
    '## Features',
    '',
    ...bulletList(input.plan.features),
    '',
    '## Required Registers',
    '',
    ...bulletList(input.plan.requiredRegisters),
    '',
    '## Key Instructions Used',
    '',
    ...bulletList(emittedInstructions),
    '',
    '## Static Scope',
    '',
    'ASM source files use parser-supported labels, comments, and instructions only. Register constants are emitted separately with the configured constant directive.'
  ]);
}

function renderSelfCheckReport(input: GenerateProjectInput): string {
  return markdown([
    '# Self-Check Report',
    '',
    '## Static Checks Represented',
    '',
    '- ASM files are generated with parser-supported labels and semicolon comments.',
    '- Instruction choices are limited to mnemonics confirmed in the built-in spec before emission.',
    '- Cross-file CALL and JMP targets are generated as labels in the emitted ASM file set.',
    '- Register constants come from spec.registers and use spec.asmSyntax.constantDirective.',
    '',
    '## Explicit Non-Claims',
    '',
    'This MVP output does not claim compile, simulation, burn, flash, hardware verification, or hardware execution results.',
    '',
    `Checked target chip: ${input.spec.chipId}.`
  ]);
}

function renderReadme(input: GenerateProjectInput): string {
  return markdown([
    `# ${input.projectName}`,
    '',
    'ASM project file set generated for the ASM Agent MVP.',
    '',
    `Target chip: ${input.spec.chipId}`,
    `Spec version: ${input.spec.version}`,
    '',
    '## Contents',
    '',
    '- `startup/reset.asm`: reset entry and jump into the application loop.',
    '- `src/main.asm`: main entry, feature initialization calls, and watchdog clear loop.',
    '- `include/registers.inc`: register constants generated from the built-in specification.',
    '- `docs/spec-compliance.md`: trace from generated files to the built-in chip specification.',
    '',
    '## MVP Boundary',
    '',
    'This generated project is a file-delivery artifact only. It does not claim compile, simulation, burn, flash, hardware verification, or hardware execution results.'
  ]);
}

function renderGitignore(): string {
  return lines([
    'build/',
    'dist/',
    'out/',
    '*.o',
    '*.obj',
    '*.elf',
    '*.bin',
    '*.hex',
    '*.map',
    '*.lst',
    '*.log',
    '*.tmp',
    '.DS_Store',
    '.vscode/.history/'
  ]);
}

function renderVscodeTasks(): string {
  return json({
    version: '2.0.0',
    tasks: [
      {
        label: 'Print ASM reports',
        type: 'shell',
        command: 'powershell',
        args: [
          '-NoProfile',
          '-Command',
          'Get-Content docs/spec-compliance.md; Get-Content docs/self-check-report.md'
        ],
        problemMatcher: []
      }
    ]
  });
}

function renderVscodeSettings(): string {
  return json({
    'files.associations': {
      '*.asm': 'asm',
      '*.inc': 'asm'
    },
    'editor.insertSpaces': true,
    'editor.tabSize': 2,
    'files.eol': '\n'
  });
}

function renderVscodeExtensions(): string {
  return json({
    recommendations: []
  });
}

function renderStaticCheckConfig(input: GenerateProjectInput): string {
  return json({
    chipId: input.spec.chipId,
    specVersion: input.spec.version,
    asmFiles: generatedAsmPaths(input),
    status: 'not-executed',
    intendedChecks: [
      'parse ASM files',
      'validate instruction mnemonics',
      'resolve generated labels',
      'review spec trace docs'
    ]
  });
}

function generatedAsmPaths(input: GenerateProjectInput): string[] {
  const features = new FeatureSet(input.plan.features);
  return [
    'startup/reset.asm',
    ...(input.plan.usesInterrupt ? ['startup/interrupt.asm'] : []),
    'src/main.asm',
    ...(features.has('GPIO') ? ['src/gpio.asm'] : []),
    ...(features.has('Timer0') ? ['src/timer0.asm'] : []),
    ...(features.has('WDT') ? ['src/wdt.asm'] : [])
  ];
}

function toGeneratedFile(draft: FileDraft): GeneratedFile {
  assertSafeRelativePath(draft.path);
  return {
    path: draft.path,
    content: ensureTrailingNewline(draft.content)
  };
}

function assertUniqueFilePaths(drafts: FileDraft[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const draft of drafts) {
    if (seen.has(draft.path)) duplicates.add(draft.path);
    seen.add(draft.path);
  }

  if (duplicates.size > 0) {
    throw new Error(`Generated project contains duplicate file path(s): ${Array.from(duplicates).join(', ')}`);
  }
}

/**
 * 工程路径校验闸门：与 SingleAsmFileGenerator 校验等级一致。
 * 把所有 .asm 文件合并成一个程序后跑 parseAsm + validateAsm，
 * 任一指令/寄存器/操作数/标签不符合内置规范就抛错，阻止非法工程输出。
 * 合并校验是因为 reset.asm 等文件存在跨文件 CALL/JMP 标签引用（如 main_entry 定义在 main.asm），
 * 逐文件独立校验会误报 UNKNOWN_LABEL。
 */
function assertAsmDraftsValid(drafts: FileDraft[], spec: ChipSpec): void {
  const asmDrafts = drafts.filter((draft) => draft.path.toLowerCase().endsWith('.asm'));
  if (asmDrafts.length === 0) return;

  const mergedSource = asmDrafts.map((draft) => draft.content).join('\n');
  const diagnostics = validateAsm(parseAsm(mergedSource), spec);

  if (diagnostics.length > 0) {
    const summary = diagnostics.map(formatAsmDiagnosticForUser).join('；');
    throw new Error(`生成的工程 ASM 未通过内置规范校验：${summary}`);
  }
}

function assertSafeRelativePath(path: string): void {
  if (!path || /^[A-Za-z]:[\\/]/u.test(path) || path.startsWith('/') || path.startsWith('\\')) {
    throw new Error(`Generated path must be relative: ${path}`);
  }

  if (path.split(/[\\/]/u).includes('..')) {
    throw new Error(`Generated path must not traverse directories: ${path}`);
  }
}

function requireInstructions(
  instructionNames: Set<string>,
  requiredInstructions: readonly string[]
): void {
  const missing = requiredInstructions.filter((instruction) => !instructionNames.has(instruction));
  if (missing.length > 0) {
    throw new Error(`Built-in spec is missing required instruction(s): ${missing.join(', ')}`);
  }
}

function filterRegisters(requiredRegisters: string[], preferredRegisters: string[]): string[] {
  const required = new Set(requiredRegisters);
  const matching = preferredRegisters.filter((register) => required.has(register));
  return matching.length > 0 ? matching : requiredRegisters;
}

class UniqueNameAllocator {
  private readonly used = new Set<string>();
  private readonly nextSuffixByBase = new Map<string, number>();

  allocate(baseName: string): string {
    if (!this.used.has(baseName)) {
      this.used.add(baseName);
      this.nextSuffixByBase.set(baseName, 2);
      return baseName;
    }

    let suffix = this.nextSuffixByBase.get(baseName) ?? 2;
    let candidate = `${baseName}_${suffix}`;

    while (this.used.has(candidate)) {
      suffix += 1;
      candidate = `${baseName}_${suffix}`;
    }

    this.used.add(candidate);
    this.nextSuffixByBase.set(baseName, suffix + 1);
    return candidate;
  }
}

function sanitizeAsmConstantName(rawName: string): string {
  const sanitized = rawName
    .replace(/[^A-Za-z0-9_]+/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^_+|_+$/gu, '');

  if (sanitized.length === 0) return 'BIT';
  if (/^[A-Za-z_]/u.test(sanitized)) return sanitized;
  return `BIT_${sanitized}`;
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(', ') : 'none specified';
}

function bulletList(values: string[]): string[] {
  if (values.length === 0) return ['- None'];
  return values.map((value) => `- ${value}`);
}

function formatHex(value: number): string {
  return `0x${value.toString(16).toUpperCase()}`;
}

function lines(values: string[]): string {
  return ensureTrailingNewline(values.join('\n'));
}

function markdown(values: string[]): string {
  return lines(values);
}

function json(value: unknown): string {
  return ensureTrailingNewline(`${JSON.stringify(value, null, 2)}`);
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`;
}
