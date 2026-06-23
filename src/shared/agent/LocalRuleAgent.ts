import type { ChipSpec } from '../spec/ChipSpec';
import type { GenerationPlan, PlanRequest, PlanResult } from './GenerationPlanner';

function includesAny(value: string, keywords: string[]): boolean {
  const normalizedValue = value.toLowerCase();
  return keywords.some((keyword) => normalizedValue.includes(keyword.toLowerCase()));
}

function matchesAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function pushUnique<T>(items: T[], item: T): void {
  if (!items.includes(item)) items.push(item);
}

function registerExists(spec: ChipSpec, registerName: string): boolean {
  return spec.registers.some(
    (register) => register.name.toLowerCase() === registerName.toLowerCase()
  );
}

function addRegisterIfPresent(spec: ChipSpec, registers: string[], registerName: string): void {
  if (registerExists(spec, registerName)) pushUnique(registers, registerName);
}

function addRegistersIfPresent(spec: ChipSpec, registers: string[], registerNames: string[]): void {
  registerNames.forEach((registerName) => addRegisterIfPresent(spec, registers, registerName));
}

function hasPreciseTimingRequirement(requirement: string): boolean {
  return (
    includesAny(requirement, ['精确', '准确', '精准', 'precise', 'precision']) ||
    /\d+(\.\d+)?\s*(毫秒|微秒|秒)/i.test(requirement) ||
    /\d+(\.\d+)?\s*(ms|us|s|khz|hz)\b/i.test(requirement)
  );
}

function hasClockSourceInput(requirement: string): boolean {
  return matchesAny(requirement, [
    /\b(osc|fosc|clock)\b/i,
    /时钟源|系统时钟/,
    /\d+(\.\d+)?\s*(mhz|khz|hz)\s*(osc|clock|时钟)/i
  ]);
}

function hasPrescalerInput(requirement: string): boolean {
  return matchesAny(requirement, [/分频|预分频/, /\bprescaler\b/i, /\b\d+\s*:\s*\d+\b/, /\/\s*\d+\b/]);
}

function hasCompletePreciseTimingInput(requirement: string): boolean {
  return hasClockSourceInput(requirement) && hasPrescalerInput(requirement);
}

function hasGpioRequirement(requirement: string): boolean {
  return (
    includesAny(requirement, ['gpio', 'pa0', 'pa ', 'pa_', '端口', '引脚', '翻转', '输出', '输入']) ||
    matchesAny(requirement, [/\bpa\d+\b/i, /\bpa_[a-z0-9_]+\b/i, /\bio\b/i, /\bi\/o\b/i])
  );
}

export class LocalRuleAgent {
  createPlan(request: PlanRequest, spec: ChipSpec): PlanResult {
    const requirement = request.requirement.trim();

    if (requirement.length < 2) {
      return {
        status: 'needsInput',
        questions: ['请补充 ASM 工程的目标功能、外设范围和期望行为。']
      };
    }

    const features: string[] = [];
    const files: string[] = [
      'startup/reset.asm',
      'src/main.asm',
      'include/registers.inc',
      'docs/spec-compliance.md'
    ];
    const requiredRegisters: string[] = [];
    const assumptions: string[] = [
      `基于内置 ${spec.chipId} 规范生成计划，寄存器只从 spec.registers 中选择。`,
      '本阶段只输出 ASM 工程生成计划，不生成工程文件内容。'
    ];

    const wantsTimer0 = includesAny(requirement, ['timer0', 't0', '定时器0', '定时器 0']);
    const wantsGpio = hasGpioRequirement(requirement);
    const wantsInterrupt = includesAny(requirement, ['中断', 'interrupt', 'irq']);
    const wantsWdt = includesAny(requirement, ['wdt', '看门狗', '清狗']);

    if (
      wantsTimer0 &&
      hasPreciseTimingRequirement(requirement) &&
      !hasCompletePreciseTimingInput(requirement)
    ) {
      return {
        status: 'needsInput',
        questions: ['请补充时钟源（例如 OSC/FOSC/系统时钟）和 Timer0 分频/预分频设置，以便推导精确定时。']
      };
    }

    if (wantsTimer0) {
      pushUnique(features, 'Timer0');
      pushUnique(files, 'src/timer0.asm');
      addRegistersIfPresent(spec, requiredRegisters, ['T0_PS', 'T0_CTR', 'T0_OVR']);
    }

    if (wantsGpio) {
      pushUnique(features, 'GPIO');
      pushUnique(files, 'src/gpio.asm');
      addRegistersIfPresent(spec, requiredRegisters, ['PA_PIO', 'PA_OE', 'PA_PU', 'PA_PD', 'PA_OD']);
    }

    if (wantsInterrupt) {
      pushUnique(features, 'Interrupt');
      pushUnique(files, 'startup/interrupt.asm');
      addRegistersIfPresent(spec, requiredRegisters, ['IW1E', 'IW1F']);
    }

    if (wantsWdt) {
      pushUnique(features, 'WDT');
      pushUnique(files, 'src/wdt.asm');
      addRegistersIfPresent(spec, requiredRegisters, ['WDT_PS', 'WDT_CTR', 'WDT_OVR']);
      assumptions.push(`WDT 计划使用 ${spec.chipId} 内置规范中列出的看门狗相关寄存器。`);
    }

    if (features.length === 0) {
      return {
        status: 'needsInput',
        questions: ['请补充目标功能，例如 Timer0、GPIO、中断或 WDT 等 ASM 工程需求。']
      };
    }

    const plan: GenerationPlan = {
      summary: `为 ${spec.chipId} 规划 ${features.join(' + ')} ASM 工程。`,
      chipId: spec.chipId,
      features,
      files,
      usesInterrupt: wantsInterrupt,
      requiredRegisters,
      assumptions
    };

    return {
      status: 'ready',
      plan
    };
  }
}
