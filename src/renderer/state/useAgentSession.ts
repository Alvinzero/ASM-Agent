import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import packageJson from '../../../package.json';

import { ProjectGenerator } from '../../shared/asm/ProjectGenerator';
import { SingleAsmFileGenerator } from '../../shared/asm/SingleAsmFileGenerator';
import { buildModelAsmGeneratedFile } from '../../shared/asm/ModelAsmCandidate';
import { AgentService } from '../../shared/agent/AgentService';
import type { GenerationPlan, PlanResult } from '../../shared/agent/GenerationPlanner';
import type { CompleteChatMessage, CompleteChatRequest, ModelStreamEventHandler } from '../../shared/agent/ModelAdapter';
import type { GeneratedFile, GeneratedProject } from '../../shared/project/ProjectTypes';
import { BuiltInSpecRepository } from '../../shared/spec/BuiltInSpecRepository';
import { appendSpecPromptAttachment } from '../../shared/spec/SpecPromptContext';
import type { AsmAgentApi } from '../global';
import { completeChatViaLocalProxy, streamChatViaLocalProxy } from './BrowserModelProxy';
import { openSessionFileViaLocalProxy, saveAsmFileViaLocalProxy } from './SessionFileProxy';
import { sessionTaskManager } from './SessionTaskManager';

const CHIP_ID = 'HK64S8x' as const;
const PLANNING_TRACE_STEP_DELAY_MS = 1200;
const SUPPLEMENTAL_PROMPT_DELAY_MS = 900;
const MODEL_CONTEXT_MESSAGE_LIMIT = 8;
const MODEL_ASM_REPAIR_ATTEMPTS = 1;
const TRACE_TYPING_CHAR_MS = 22;
const TRACE_NARRATION_HOLD_MS = 420;
const TRACE_COMMAND_STEP_MS = 460;
const TRACE_ACTION_RUN_MS = 1500;
const TRACE_EDIT_HOLD_MS = 520;
const LOCAL_ANSWER_STREAM_CHARS = 28;
const LOCAL_ANSWER_STREAM_STEP_MS = 18;
let browserFallbackAgent: AsmAgentApi | null = null;
const APP_VERSION = packageJson.version;

interface ActiveRun {
  id: string;
  controller: AbortController;
  startedAt: number;
}

export type TraceNodeStatus = 'running' | 'done';

export interface TraceCommand {
  text: string;
  result?: string;
  status: TraceNodeStatus;
}

export interface TraceNode {
  id: string;
  type: 'narration' | 'commands' | 'action' | 'edit' | 'reasoning';
  status: TraceNodeStatus;
  /** narration/reasoning 正文 / action 标题 / edit 描述 / commands 组完成后的标题 */
  text: string;
  /** narration 打字机已揭示的字符数（仅 narration 使用） */
  revealed?: number;
  /** action 完成后的结果文案 */
  result?: string;
  /** commands 组内的命令列表 */
  commands?: TraceCommand[];
}

export interface AssistantMessage {
  id: string;
  role: 'assistant' | 'user' | 'system';
  kind?: 'text' | 'trace';
  text: string;
  status?: 'thinking';
  /** kind === 'trace' 时的时间线节点 */
  nodes?: TraceNode[];
}

function finishRunningTraceNode(node: TraceNode): TraceNode {
  if (node.status !== 'running') return node;

  if (node.type === 'action') {
    return { ...node, status: 'done', result: node.result ?? '已停止' };
  }

  if (node.type === 'commands') {
    return {
      ...node,
      status: 'done',
      commands: node.commands?.map((command) =>
        command.status === 'running' ? { ...command, status: 'done', result: command.result ?? '已停止' } : command
      )
    };
  }

  if (node.type === 'narration') {
    return { ...node, status: 'done', revealed: node.revealed ?? node.text.length };
  }

  return { ...node, status: 'done' };
}

function finishRunningMessage(message: AssistantMessage): AssistantMessage {
  if (message.kind !== 'trace') {
    return message.status === 'thinking' ? { ...message, status: undefined } : message;
  }

  return {
    ...message,
    status: undefined,
    nodes: message.nodes?.map(finishRunningTraceNode)
  };
}

export interface AgentModelRuntime {
  provider: string;
  label: string;
  isConfigured: boolean;
  apiKey?: string;
  baseUrl?: string;
  modelId?: string;
}

export interface AsmFileMeta {
  path: string;
  absolutePath?: string;
  sessionDir?: string;
  content: string;
  sizeLabel: string;
  lineCount: number;
  generatedAt: number;
}

export interface AgentSessionState {
  sessionId: string;
  chipId: typeof CHIP_ID;
  apiVersion: string | null;
  isBridgeReady: boolean;
  requirement: string;
  plan: GenerationPlan | null;
  project: GeneratedProject | null;
  asmFile: AsmFileMeta | null;
  canGenerateProject: boolean;
  pendingNormalizationRequirement: string | null;
  normalizationStatus: 'idle' | 'draftReady' | 'normalizing' | 'validated' | 'failed';
  canNormalizeAsm: boolean;
  messages: AssistantMessage[];
  loading: 'idle' | 'planning' | 'generating';
  error: string | null;
  setRequirement: (value: string) => void;
  createPlan: (modelRuntime?: AgentModelRuntime) => Promise<void>;
  cancelCurrentRun: () => void;
  generateProject: () => Promise<void>;
  normalizeAsm: (sourceCode?: string) => Promise<void>;
  openAsmFile: () => Promise<void>;
  resetSession: () => string;
  createSnapshot: () => AgentSessionSnapshot;
  restoreSnapshot: (snapshot: AgentSessionSnapshot) => void;
}

export interface AgentSessionSnapshot {
  sessionId: string;
  requirement: string;
  plannedRequirement: string | null;
  pendingNormalizationRequirement: string | null;
  normalizationStatus: AgentSessionState['normalizationStatus'];
  plan: GenerationPlan | null;
  project: GeneratedProject | null;
  asmFile: AsmFileMeta | null;
  messages: AssistantMessage[];
  loading: AgentSessionState['loading'];
  error: string | null;
}

function buildAsmFileMeta(file: GeneratedFile, savedFile?: { absolutePath: string; sessionDir: string }): AsmFileMeta {
  const content = file.content;
  const byteLength = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(content).length : content.length;
  const sizeLabel = byteLength >= 1024 ? `${(byteLength / 1024).toFixed(1)} KB` : `${byteLength} B`;
  const lineCount = content.length === 0 ? 0 : content.replace(/\n+$/, '').split('\n').length;

  return {
    path: file.path,
    absolutePath: savedFile?.absolutePath,
    sessionDir: savedFile?.sessionDir,
    content,
    sizeLabel,
    lineCount,
    generatedAt: Date.now()
  };
}

const initialMessages: AssistantMessage[] = [
  {
    id: 'system-ready',
    role: 'assistant',
    text: 'ASM 汇编工程生成智能体已连接内置 HK64S8x 规范库。'
  }
];

function createEmptySessionSnapshot(sessionId: string): AgentSessionSnapshot {
  return {
    sessionId,
    requirement: '',
    plannedRequirement: null,
    pendingNormalizationRequirement: null,
    normalizationStatus: 'idle',
    plan: null,
    project: null,
    asmFile: null,
    messages: initialMessages,
    loading: 'idle',
    error: null
  };
}

function normalizeSnapshotForTaskState(snapshot: AgentSessionSnapshot): AgentSessionSnapshot {
  const hasActiveTask = sessionTaskManager.hasActiveTask(snapshot.sessionId);

  if (hasActiveTask) {
    return {
      ...snapshot,
      loading: snapshot.loading === 'idle' ? 'planning' : snapshot.loading
    };
  }

  return {
    ...snapshot,
    loading: 'idle',
    messages: snapshot.messages.map(finishRunningMessage)
  };
}

export function getAsmAgent(): AsmAgentApi | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.asmAgent ?? getBrowserFallbackAgent();
}

function getBrowserFallbackAgent(): AsmAgentApi {
  if (browserFallbackAgent) return browserFallbackAgent;

  const specs = new BuiltInSpecRepository();
  const agentService = new AgentService(specs);
  const projectGenerator = new ProjectGenerator();

  browserFallbackAgent = {
    version: APP_VERSION,
    createPlan: (payload) => agentService.createPlan(payload),
    completeChat: (payload, signal) => completeChatViaLocalProxy(payload, fetch, signal),
    completeChatStream: (payload, onEvent, signal) => streamChatViaLocalProxy(payload, onEvent, fetch, signal),
    saveAsmFile: (payload) => saveAsmFileViaLocalProxy(payload),
    openFile: (payload) => openSessionFileViaLocalProxy(payload),
    generateProject: (payload) =>
      Promise.resolve(
        projectGenerator.generate({
          projectName: payload.projectName,
          requirement: payload.requirement,
          plan: payload.plan,
          spec: specs.getByChipId(payload.plan.chipId)
        })
      )
  };

  return browserFallbackAgent;
}

function buildProjectName(requirement: string): string {
  const normalized = requirement
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);

  return normalized || 'hk64s8x-asm-project';
}

function buildSingleAsmAnswer(file: GeneratedFile): string {
  return [
    `已按内置 HK64S8x 规范生成单文件 ASM：\`${file.path}\`。`,
    '',
    '```asm',
    file.content.trimEnd(),
    '```',
    '',
    '规范自检：已通过本地指令、寄存器、标签和操作数静态校验；后续仍需用公司 ASM 编译器做真实汇编验证。'
  ].join('\n');
}

function buildNormalizationRequirementFromSource(sourceCode?: string): string | null {
  const source = sourceCode?.trim();
  if (!source) return null;

  const features = inferAsmSourceFeatures(source);
  return [
    '根据下面 ASM 代码块进行本地规范化，生成 HK64S8x 单文件 main.asm。',
    `可识别意图：${features.join(' + ')}。`,
    '要求：使用内置 HK64S8x 指令、寄存器和标签规范替换草稿中不确定或非法的写法。',
    '原始 ASM 代码：',
    source
  ].join('\n');
}

function inferAsmSourceFeatures(sourceCode: string): string[] {
  const features: string[] = [];
  const pushFeature = (feature: string) => {
    if (!features.includes(feature)) features.push(feature);
  };

  if (/\b(timer0|t0|t0_[a-z0-9_]*|timer)\b/i.test(sourceCode) || /定时器/.test(sourceCode)) {
    pushFeature('Timer0');
  }

  if (/\b(gpio|pa\d|pa_[a-z0-9_]*|p\d_[a-z0-9_]*|pio|dir|led)\b/i.test(sourceCode) || /端口|引脚|输出|输入/.test(sourceCode)) {
    pushFeature('GPIO');
  }

  if (/\b(interrupt|irq|reti|iw\d?[ef])\b/i.test(sourceCode) || /中断/.test(sourceCode)) {
    pushFeature('Interrupt');
  }

  if (/\b(wdt|clrwdt|watchdog)\b/i.test(sourceCode) || /看门狗|清狗/.test(sourceCode)) {
    pushFeature('WDT');
  }

  return features.length > 0 ? features : ['GPIO'];
}

function messageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createSessionId(): string {
  return messageId('session');
}

interface TraceScriptCommand {
  text: string;
  result: string;
}

type TraceScriptStep =
  | { kind: 'narration'; text: string }
  | { kind: 'commands'; title: string; commands: TraceScriptCommand[] }
  | { kind: 'action'; title: string; result: string }
  | { kind: 'edit'; text: string };

type AssistantIntent = 'ordinaryChat' | 'asmHelp' | 'asmGeneration' | 'unclearGeneration';

function normalizeInput(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function includesAny(value: string, keywords: string[]): boolean {
  return keywords.some((keyword) => value.includes(keyword.toLowerCase()));
}

function hasQuestionShape(value: string): boolean {
  return /[?？]/.test(value) || includesAny(value, ['是什么', '什么是', '怎么', '如何', '哪些', '为什么', '能不能', '可以吗', '需要什么', '需要哪些']);
}

function isIdentityOrCapabilityQuestion(value: string): boolean {
  return includesAny(value, [
    '你是什么',
    '你是谁',
    '什么大模型',
    '你的模型',
    '你能做什么',
    '你可以做什么',
    '怎么使用你',
    '如何使用你',
    '使用方法',
    'who are you',
    'what model'
  ]);
}

function hasAsmDomainSignal(value: string): boolean {
  return includesAny(value, [
    'asm',
    '汇编',
    'hk64s8x',
    'timer0',
    '定时器',
    'gpio',
    'pa0',
    'pa1',
    '中断',
    'interrupt',
    'irq',
    'wdt',
    '看门狗',
    '寄存器',
    '指令',
    '时钟源',
    'fosc',
    'osc',
    '分频',
    '预分频'
  ]);
}

function hasGenerationSignal(value: string): boolean {
  return includesAny(value, ['生成', '写', '创建', '实现', '输出', '工程', '代码', 'project', 'generate', 'write', 'create', 'implement']);
}

function hasVagueGenerationSignal(value: string): boolean {
  return includesAny(value, ['帮我写个中断', '写个中断', '生成中断', '做个中断']);
}

function classifyAssistantIntent(input: string): AssistantIntent {
  const normalized = normalizeInput(input);

  if (isIdentityOrCapabilityQuestion(normalized)) {
    return 'ordinaryChat';
  }

  if (!hasAsmDomainSignal(normalized)) {
    return 'ordinaryChat';
  }

  if (hasQuestionShape(normalized) && !hasGenerationSignal(normalized)) {
    return 'asmHelp';
  }

  if (hasVagueGenerationSignal(normalized)) {
    return 'unclearGeneration';
  }

  return 'asmGeneration';
}

function buildOrdinaryChatResponse(input: string, modelRuntime?: AgentModelRuntime): string {
  const normalized = normalizeInput(input);
  const modelText =
    modelRuntime && modelRuntime.provider !== 'local'
      ? `当前界面选择的是 ${modelRuntime.label}${modelRuntime.isConfigured ? '，API 已配置' : '，但 API 还未配置'}。`
      : '当前本地模式使用内置规则引擎。';

  if (isIdentityOrCapabilityQuestion(normalized)) {
    return `我是 HK64S8x ASM 工程智能体，不等同于单一固定大模型；${modelText} 我的核心能力是内置公司 HK64S8x 指令集、寄存器和 ASM 语法约束，生成代码时会严格按这些边界执行。也可以回答普通使用问题、解释 ASM 概念，或者帮你把自然语言需求整理成可生成的 ASM 工程条件。`;
  }

  if (includesAny(normalized, ['你好', 'hello', 'hi'])) {
    return '你好，我在。你可以直接问普通问题，也可以描述一个 HK64S8x ASM 需求；如果要生成代码，我会先检查信息是否足够，缺少关键参数时会在对话里追问。';
  }

  return `我可以先按普通对话回答。当前这个本地版本最擅长 HK64S8x ASM 工程、指令/寄存器约束和需求澄清；开放领域问题如果需要更强推理或实时信息，可以在“模型配置”里接入 DeepSeek、GLM、GPT、Qwen 或 OpenAI 兼容 API。`;
}

function canUseExternalModel(modelRuntime?: AgentModelRuntime): modelRuntime is AgentModelRuntime & {
  apiKey: string;
  baseUrl: string;
  modelId: string;
} {
  return Boolean(
    modelRuntime &&
      modelRuntime.provider !== 'local' &&
      modelRuntime.isConfigured &&
      modelRuntime.apiKey?.trim() &&
      modelRuntime.baseUrl?.trim() &&
      modelRuntime.modelId?.trim()
  );
}

function buildOrdinaryChatSystemPrompt(modelRuntime: AgentModelRuntime): string {
  return [
    '你是 HK64S8x ASM 工程智能体，面向公司芯片平台开发者。',
    `当前接入的第三方模型通道是 ${modelRuntime.label}，模型 ID 是 ${modelRuntime.modelId ?? '未指定'}。`,
    '你可以像普通对话型智能体一样回答非 ASM 问题，但不要声称自己拥有未提供的实时联网、天气、新闻或价格查询能力。',
    '涉及 HK64S8x ASM 代码、寄存器、指令、定时器、中断或外设时，必须提醒用户最终代码需要通过内置 HK64S8x 规范校验，不能编造未确认的指令或寄存器。',
    '用中文回答，保持简洁自然。'
  ].join('\n');
}

function buildCompleteChatRequest(
  prompt: string,
  modelRuntime: AgentModelRuntime & {
    apiKey: string;
    baseUrl: string;
    modelId: string;
  },
  systemPrompt = buildOrdinaryChatSystemPrompt(modelRuntime),
  messages?: CompleteChatMessage[]
): CompleteChatRequest {
  return {
    provider: modelRuntime.provider,
    label: modelRuntime.label,
    apiKey: modelRuntime.apiKey,
    baseUrl: modelRuntime.baseUrl,
    modelId: modelRuntime.modelId,
    prompt,
    systemPrompt,
    messages
  };
}

function buildAsmModelAnalysisSystemPrompt(modelRuntime: AgentModelRuntime): string {
  return [
    '你是 HK64S8x ASM 工程智能体的外部大模型分析通道，输出会直接展示给用户。',
    `当前接入的第三方模型通道是 ${modelRuntime.label}，模型 ID 是 ${modelRuntime.modelId ?? '未指定'}。`,
    '不要输出隐藏思维链，不要声称正在展示完整推理过程；请输出简明、可展示的任务分析。',
    '芯片指令、寄存器、寻址方式和 ASM 语法以内置 HK64S8x 规范库为最终准绳；不确定时必须标注“需由内置规范校验确认”，不能编造具体指令、寄存器或地址。',
    '当前项目 MVP 不做编译、仿真、烧录；可以提及后续需要用户在真实工具链中验证。',
    '用中文回答，按“需求理解 / 需要补充 / 候选工程思路”组织，每段控制在 1-3 条。'
  ].join('\n');
}

function buildAsmModelAnalysisPrompt(requirement: string): string {
  return [
    `用户需求：${requirement}`,
    '',
    '请给出面向 HK64S8x ASM 工程生成的可展示分析：',
    '1. 判断这是普通咨询、参数澄清还是工程生成请求。',
    '2. 如果缺少 Timer0 周期、时钟源、分频/预分频、引脚行为、中断策略等关键参数，请直接列出需要追问的参数。',
    '3. 如果信息足够，请给出工程文件、启动流程、中断处理和寄存器配置的候选思路，但不要编造未确认的芯片语法细节。'
  ].join('\n');
}

function buildAsmModelGenerationSystemPrompt(modelRuntime: AgentModelRuntime): string {
  return [
    '你是 HK64S8x ASM 工程智能体的外部大模型 ASM 生成通道。',
    `当前接入的第三方模型通道是 ${modelRuntime.label}，模型 ID 是 ${modelRuntime.modelId ?? '未指定'}。`,
    '系统提示中会附加 SPEC_DRIVEN_ASM_CONTEXT，它是从公司 JSON 规范机械生成的完整约束载荷。',
    '必须只使用该载荷中存在的指令、寄存器、位字段、地址、向量、内存区域和 ASM 语法。',
    '禁止使用 ORG、END、EQU、DB、DS、DW、SECTION、SEGMENT、INCLUDE、MACRO、PROC 等规范载荷里不存在的伪指令。',
    '不要把规范语法里的 R 当成真实寄存器；R 只是操作数占位符。需要临时计数器时使用 RAM 数字地址并写成 ASMC H 后缀形式，例如 80H，而不是 R0/R1/R2 或 0x80。',
    '严禁混入 8051/兼容 MCU 方言，例如 SETB、DJNZ、JB、JNB、JBC、JC、JNC、ORL、ANL、XRL、MOVX、MOVC、CY、R0-R7；如果 payload 未列出，就绝对不要输出。',
    '如果需求缺少会影响正确性的参数，请先明确指出缺失参数；如果可以生成，请输出一个且仅一个 ```asm 代码块作为 main.asm 内容。',
    '不要输出隐藏思维链，不要声称已经通过本地质检；本地程序会在你返回后运行 parseAsm + validateAsm。'
  ].join('\n');
}

function buildAsmModelGenerationPrompt(requirement: string): string {
  return [
    `用户需求：${requirement}`,
    '',
    '请结合 SPEC_DRIVEN_ASM_CONTEXT 直接生成符合公司规范的 HK64S8x ASM：',
    '1. 只输出一个 main.asm 的 ```asm 代码块；代码块外可以有极短说明，但不要再给草稿版本。',
    '2. 指令、寄存器、位字段、地址、标签跳转和操作数必须能被本地 parseAsm + validateAsm 通过。',
    '3. 寄存器数字地址、JMP/CALL 数字地址必须使用 ASMC 的 H 后缀，例如 38H、46H、20H；不要输出 CALL 46、JMP 20、MOV 38,A 或 0x38 这类裸数字/0x 地址。',
    '4. 禁止使用 ORG、END、EQU、DB、DS、DW、SECTION、SEGMENT、INCLUDE、MACRO、PROC 等规范载荷里不存在的伪指令、宏、段语法或 include。',
    '5. 不要把规范语法里的 R 当成真实寄存器；R 只是操作数占位符。需要临时计数器时使用 RAM 数字地址并写成 ASMC H 后缀形式，例如 80H；不要输出 R0、R1、R2 或 0x80。',
    '5.1 严禁输出 8051/兼容 MCU 方言，例如 SETB、DJNZ、JB、JNB、JBC、JC、JNC、ORL、ANL、XRL、MOVX、MOVC、CY、R0-R7；如果需求像 I2C/OLED，请也只能用 HK64S8x payload 中真实存在的指令和位操作方式表达。',
    '6. 如果需求涉及 PA 彩灯、LED 或闪烁，必须用明确灯态掩码写 PA_PIO(38H)，例如 PA0/PA1/PA2 轮闪用 #01H -> #02H -> #04H -> #00H，或整体闪烁用 #07H -> #00H；每个可见灯态后调用 DELAY。不要用 #01H OR 计数器、计数器直接写端口、或任何会让某个 PA 位常亮的计算掩码。',
    '7. 软件延时计数器必须使用 DECSZR/INCSZR 这类会回写 RAM 的 skip 指令；不要用 DECSZ/INCSZ 做 RAM 计数循环，因为它们只把结果写到 A，会导致延时卡死在某个灯态。',
    '8. 按用户给出的主频估算软件延时，不要随意放大外层循环。16MHz 下三层 DECSZR 延时 #0AH/#FFH/#FFH 约为 500ms 量级；#7AH/#FFH/#FFH 会远超 500ms。',
    '9. 不要使用规范载荷中没有的寄存器名、伪指令、宏、段语法或外部 include。',
    '10. 如果信息不足以安全生成可质检 ASM，请不要编造代码，直接说明缺少哪些参数。'
  ].join('\n');
}

function buildAsmModelRepairPrompt(requirement: string, previousResponse: string, validationError: string): string {
  return [
    `用户需求：${requirement}`,
    '',
    '上一次你返回的 ASM 没有通过本地 HK64S8x JSON 规范质量闸。',
    '质检诊断：',
    validationError,
    '',
    '上一次模型返回：',
    '```text',
    previousResponse.trim(),
    '```',
    '',
    '请根据同一个 SPEC_DRIVEN_ASM_CONTEXT 重新生成一个且仅一个 main.asm 的 ```asm 代码块。',
    '必须修复所有质检诊断；不要解释草稿，不要输出多个版本。',
    '不要使用 ORG、END、EQU、DB、DS、DW、SECTION、SEGMENT、INCLUDE、MACRO、PROC 等规范载荷里不存在的伪指令。',
    '不要把规范语法里的 R 当成真实寄存器；R 只是操作数占位符。需要临时计数器时使用 RAM 数字地址并写成 ASMC H 后缀形式，例如 80H；不要输出 R0、R1、R2 或 0x80。',
    '严禁输出 8051/兼容 MCU 方言，例如 SETB、DJNZ、JB、JNB、JBC、JC、JNC、ORL、ANL、XRL、MOVX、MOVC、CY、R0-R7；如果上一次失败与这类词有关，必须全部替换成 HK64S8x payload 中真实存在的指令、寄存器或 RAM H 地址写法。',
    '若需求涉及 PA 彩灯、LED 或闪烁，必须用明确灯态掩码写 PA_PIO(38H)，例如 #01H -> #02H -> #04H -> #00H 或 #07H -> #00H；每个可见灯态后调用 DELAY。不要用 #01H OR 计数器、计数器直接写端口、或任何会让某个 PA 位常亮的计算掩码。',
    '软件延时计数器必须使用 DECSZR/INCSZR 这类会回写 RAM 的 skip 指令；不要用 DECSZ/INCSZ 做 RAM 计数循环，因为它们只把结果写到 A，会导致延时卡死在某个灯态。',
    '按用户给出的主频估算软件延时，不要随意放大外层循环。16MHz 下三层 DECSZR 延时 #0AH/#FFH/#FFH 约为 500ms 量级；#7AH/#FFH/#FFH 会远超 500ms。',
    '不要使用规范载荷中没有的伪指令、宏、段语法或 include。',
    '寄存器数字地址、JMP/CALL 数字地址必须使用 ASMC 的 H 后缀，例如 38H、46H、20H。'
  ].join('\n');
}

function buildSpecDrivenAsmSystemPrompt(baseSystemPrompt: string): string {
  const spec = new BuiltInSpecRepository().getByChipId(CHIP_ID);
  return appendSpecPromptAttachment(baseSystemPrompt, spec);
}

function buildVisibleModelContext(messages: AssistantMessage[], currentPrompt: string): CompleteChatMessage[] {
  const currentPromptText = currentPrompt.trim();
  const context = messages
    .filter((message) => (message.role === 'assistant' || message.role === 'user') && message.status !== 'thinking')
    .filter((message) => message.id !== 'system-ready')
    .map((message) => ({
      role: message.role as CompleteChatMessage['role'],
      content: message.text.trim()
    }))
    .filter((message) => message.content);
  const latest = context.slice(-MODEL_CONTEXT_MESSAGE_LIMIT);

  if (!currentPromptText) return latest;
  const alreadyIncludesCurrentPrompt =
    latest.length > 0 && latest[latest.length - 1]?.role === 'user' && latest[latest.length - 1]?.content === currentPromptText;

  return alreadyIncludesCurrentPrompt ? latest : [...latest, { role: 'user', content: currentPromptText }];
}

async function completeConfiguredModelChat(
  prompt: string,
  modelRuntime: AgentModelRuntime & {
    apiKey: string;
    baseUrl: string;
    modelId: string;
  },
  systemPrompt?: string,
  messages?: CompleteChatMessage[],
  onEvent?: ModelStreamEventHandler,
  signal?: AbortSignal
): Promise<string> {
  const payload = buildCompleteChatRequest(prompt, modelRuntime, systemPrompt, messages);
  const asmAgent = getAsmAgent();
  if (onEvent && asmAgent?.completeChatStream) {
    return asmAgent.completeChatStream(payload, onEvent, signal);
  }

  if (asmAgent?.completeChat) {
    return asmAgent.completeChat(payload, signal);
  }

  if (onEvent) {
    return streamChatViaLocalProxy(payload, onEvent, fetch, signal);
  }

  return completeChatViaLocalProxy(payload, fetch, signal);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function formatModelError(error: unknown): string {
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return '模型调用失败：浏览器无法直接访问该模型接口，可能是 CORS 拦截或网络不可达。请使用桌面版，或确认 Base URL 支持浏览器跨域请求。';
  }

  const message = error instanceof Error ? error.message : '未知错误';
  return `模型调用失败：${message}`;
}

function buildAsmHelpResponse(input: string): string {
  const normalized = normalizeInput(input);

  if (includesAny(normalized, ['1ms', '1 ms', '1毫秒', '精确', '精准', 'precise']) && includesAny(normalized, ['timer0', '定时器'])) {
    return '精确 1ms Timer0 通常需要这些参数：时钟源/FOSC 频率、Timer0 计数位宽和溢出规则、分频/预分频、初值或重装载策略、中断入口、清中断标志方式，以及可接受误差。给出这些参数后，我就可以按 HK64S8x 内置规范生成对应 ASM 工程。';
  }

  if (includesAny(normalized, ['timer0', '定时器'])) {
    return 'Timer0 相关问题我可以解释工作方式、需要的寄存器约束、定时计算条件和中断处理流程。若要生成工程，请同时说明目标周期、时钟源、分频/预分频、是否使用中断以及目标引脚行为。';
  }

  if (includesAny(normalized, ['寄存器', '指令', 'asm', '汇编'])) {
    return '可以，我可以围绕 HK64S8x 的内置指令集、寄存器表和 ASM 语法做解释。涉及生成代码时，我只会使用内置规范中存在的指令、寄存器、寻址方式和段定义。';
  }

  return '这是 ASM 相关咨询，我会先按解释和澄清来回答；如果你想生成工程，请明确目标外设、目标行为、时钟/中断/引脚等约束。';
}

function buildUnclearGenerationResponse(): string {
  return '这个需求像是在生成 ASM 工程，但信息还不够明确。请补充目标外设、触发方式、目标引脚或寄存器行为；如果涉及 Timer0 精确定时，还需要时钟源和分频/预分频设置。';
}

function buildPlanningTrace(requirement: string, modelRuntime?: AgentModelRuntime): TraceScriptStep[] {
  const normalizedRequirement = requirement.replace(/\s+/g, ' ').trim();
  const isExternalModel = modelRuntime && modelRuntime.provider !== 'local';
  const hasConfiguredExternalModel = canUseExternalModel(modelRuntime);

  if (hasConfiguredExternalModel) {
    return [
      {
        kind: 'narration',
        text: `收到需求“${normalizedRequirement}”。我先把它组装成 ${modelRuntime.label} 的请求上下文，带上 HK64S8x 内置规范摘要和输出格式约束，再交给本地规划器和规范校验把关。`
      },
      {
        kind: 'commands',
        title: '已运行 2 条命令',
        commands: [
          { text: 'rg -n "instruction|register|interrupt" spec/HK64S8x', result: '命中内置规范条目' },
          { text: `assemble-context --model ${modelRuntime.modelId ?? modelRuntime.label}`, result: '上下文已组装' }
        ]
      },
      {
        kind: 'narration',
        text: `${modelRuntime.label} API 已配置。我会让模型给出候选思路，但不会直接采信它的芯片语法——候选内容仍要过本地 ASM 规划与 HK64S8x 规范校验。`
      },
      { kind: 'action', title: `确认 ${modelRuntime.label} 通道可用`, result: '通道就绪' },
      {
        kind: 'narration',
        text: '最后跑一遍 HK64S8x 规范校验：检查指令、寄存器、中断入口和工程结构是否都在规范边界内，然后决定是直接输出还是追问缺失参数。'
      },
      { kind: 'action', title: '运行 HK64S8x 规范校验', result: '基础约束通过' }
    ];
  }

  const fallbackText =
    isExternalModel && modelRuntime
      ? `${modelRuntime.label} API 未完整配置，这轮我用本地规则引擎兜底。已接收需求“${normalizedRequirement}”，先建立任务上下文。`
      : `收到需求“${normalizedRequirement}”，这轮按 HK64S8x ASM 工程生成任务来处理。我先建立任务上下文，再逐步推进。`;

  return [
    { kind: 'narration', text: fallbackText },
    {
      kind: 'commands',
      title: '已运行 2 条命令',
      commands: [
        { text: 'rg -n "instruction set|opcode|addressing" spec/HK64S8x', result: '加载指令与寻址约束' },
        { text: 'rg -n "register map|SFR|interrupt vector" spec/HK64S8x', result: '加载寄存器与中断表' }
      ]
    },
    {
      kind: 'narration',
      text: '内置规范已加载。后续输出只能使用规范内存在的指令、寄存器、寻址方式和段定义；接下来跑本地规则规划器生成候选方案。'
    },
    { kind: 'action', title: '运行本地规则规划器', result: '已生成候选方案' },
    {
      kind: 'narration',
      text: '候选方案出来了，现在做最后一步 HK64S8x 规范校验，确认指令、寄存器、中断入口和工程结构都合规，再决定输出结果还是追问缺参数。'
    },
    { kind: 'action', title: '运行 HK64S8x 规范校验', result: '基础约束通过' }
  ];
}

function buildPostModelValidationTrace(modelRuntime: AgentModelRuntime): TraceScriptStep[] {
  return [
    {
      kind: 'narration',
      text: `${modelRuntime.label} 已带着完整 JSON 规范返回 ASM。现在不做本地改写，只抽取代码块并按 HK64S8x JSON 规范做最终质检。`
    },
    {
      kind: 'commands',
      title: '已运行 2 条检查',
      commands: [
        { text: `extract-asm --model ${modelRuntime.modelId ?? modelRuntime.label}`, result: '已抽取 main.asm 代码块' },
        { text: 'npm run asm:validate -- main.asm', result: '本地规范校验通过' }
      ]
    },
    { kind: 'action', title: '运行 HK64S8x 规范校验', result: '基础约束通过' }
  ];
}

function appendRunningActionNode(
  appendTraceNode: (messageId: string, node: TraceNode, targetSessionId?: string) => void,
  traceId: string,
  title: string,
  targetSessionId: string
): string {
  const nodeId = messageId('node');
  appendTraceNode(traceId, { id: nodeId, type: 'action', status: 'running', text: title }, targetSessionId);
  return nodeId;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Aborted', 'AbortError'));
  }

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      window.clearTimeout(timeoutId);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', abort, { once: true });
  });
}

function readStreamPrefix(text: string, length: number): string {
  return Array.from(text).slice(0, length).join('');
}

export function useAgentSession(initialSnapshot?: AgentSessionSnapshot | null): AgentSessionState {
  const [initialSessionSnapshot] = useState(() =>
    initialSnapshot ? normalizeSnapshotForTaskState(initialSnapshot) : createEmptySessionSnapshot(createSessionId())
  );
  const [sessionId, setSessionId] = useState(initialSessionSnapshot.sessionId);
  const [requirement, setRequirement] = useState(initialSessionSnapshot.requirement);
  const [plannedRequirement, setPlannedRequirement] = useState<string | null>(initialSessionSnapshot.plannedRequirement);
  const [pendingNormalizationRequirement, setPendingNormalizationRequirement] = useState<string | null>(
    initialSessionSnapshot.pendingNormalizationRequirement
  );
  const [normalizationStatus, setNormalizationStatus] = useState<AgentSessionState['normalizationStatus']>(
    initialSessionSnapshot.normalizationStatus
  );
  const [plan, setPlan] = useState<GenerationPlan | null>(initialSessionSnapshot.plan);
  const [project, setProject] = useState<GeneratedProject | null>(initialSessionSnapshot.project);
  const [asmFile, setAsmFile] = useState<AsmFileMeta | null>(initialSessionSnapshot.asmFile);
  const [messages, setMessages] = useState<AssistantMessage[]>(initialSessionSnapshot.messages);
  const [loading, setLoading] = useState<AgentSessionState['loading']>(initialSessionSnapshot.loading);
  const [error, setError] = useState<string | null>(initialSessionSnapshot.error);
  const [apiVersion] = useState(() => getAsmAgent()?.version ?? APP_VERSION);
  const activeRunRef = useRef<ActiveRun | null>(null);
  const isBridgeReady = apiVersion !== null;
  const [, forceUpdate] = useState({});
  const activeSessionIdRef = useRef(sessionId);
  const currentSnapshotRef = useRef<AgentSessionSnapshot>({
    sessionId,
    requirement,
    plannedRequirement,
    pendingNormalizationRequirement,
    normalizationStatus,
    plan,
    project,
    asmFile,
    messages,
    loading,
    error
  });
  const sessionSnapshotsRef = useRef<Map<string, AgentSessionSnapshot>>(
    new Map([[sessionId, currentSnapshotRef.current]])
  );

  const applySnapshotToActiveState = useCallback((snapshot: AgentSessionSnapshot) => {
    activeSessionIdRef.current = snapshot.sessionId;
    currentSnapshotRef.current = snapshot;
    sessionSnapshotsRef.current.set(snapshot.sessionId, snapshot);
    setSessionId(snapshot.sessionId);
    setRequirement(snapshot.requirement);
    setPlannedRequirement(snapshot.plannedRequirement);
    setPendingNormalizationRequirement(snapshot.pendingNormalizationRequirement);
    setNormalizationStatus(snapshot.normalizationStatus);
    setPlan(snapshot.plan);
    setProject(snapshot.project);
    setAsmFile(snapshot.asmFile);
    setMessages(snapshot.messages);
    setLoading(snapshot.loading);
    setError(snapshot.error);
  }, []);

  const mutateSessionSnapshot = useCallback(
    (targetSessionId: string, updater: (snapshot: AgentSessionSnapshot) => AgentSessionSnapshot) => {
      const isActiveSession = activeSessionIdRef.current === targetSessionId;
      const baseSnapshot = isActiveSession
        ? currentSnapshotRef.current
        : sessionSnapshotsRef.current.get(targetSessionId);

      if (!baseSnapshot) return;

      const nextSnapshot = updater(baseSnapshot);
      sessionSnapshotsRef.current.set(targetSessionId, nextSnapshot);

      if (isActiveSession) {
        applySnapshotToActiveState(nextSnapshot);
      }
    },
    [applySnapshotToActiveState]
  );

  useEffect(() => {
    const snapshot: AgentSessionSnapshot = {
      sessionId,
      requirement,
      plannedRequirement,
      pendingNormalizationRequirement,
      normalizationStatus,
      plan,
      project,
      asmFile,
      messages,
      loading,
      error
    };
    activeSessionIdRef.current = sessionId;
    currentSnapshotRef.current = snapshot;
    sessionSnapshotsRef.current.set(sessionId, snapshot);
  }, [
    asmFile,
    error,
    loading,
    messages,
    normalizationStatus,
    pendingNormalizationRequirement,
    plan,
    plannedRequirement,
    project,
    requirement,
    sessionId
  ]);

  // 订阅全局任务管理器的状态变化，用于触发 UI 重新渲染
  useEffect(() => {
    const unsubscribe = sessionTaskManager.subscribe(() => {
      forceUpdate({});
    });
    return unsubscribe;
  }, []);

  const addMessage = useCallback(
    (
      role: AssistantMessage['role'],
      text: string,
      status?: AssistantMessage['status'],
      targetSessionId = activeSessionIdRef.current
    ) => {
      const id = messageId(role);
      mutateSessionSnapshot(targetSessionId, (snapshot) => ({
        ...snapshot,
        messages: [...snapshot.messages, { id, role, text, status }]
      }));
      return id;
    },
    [mutateSessionSnapshot]
  );

  const updateMessage = useCallback(
    (
      id: string,
      next: Pick<AssistantMessage, 'text'> & { status?: AssistantMessage['status'] },
      targetSessionId = activeSessionIdRef.current
    ) => {
      mutateSessionSnapshot(targetSessionId, (snapshot) => ({
        ...snapshot,
        messages: snapshot.messages.map((message) =>
          message.id === id
            ? {
                ...message,
                text: next.text,
                status: next.status
              }
            : message
        )
      }));
    },
    [mutateSessionSnapshot]
  );

  // ---- 时间线（trace）节点管理：Codex 风格 叙述→工具→叙述 交替信息流 ----
  const streamAssistantAnswer = useCallback(
    async (text: string, signal?: AbortSignal, targetSessionId = activeSessionIdRef.current) => {
      const id = addMessage('assistant', '', 'thinking', targetSessionId);
      const characterCount = Array.from(text).length;

      for (let revealed = 1; revealed <= characterCount; revealed += LOCAL_ANSWER_STREAM_CHARS) {
        updateMessage(id, { text: readStreamPrefix(text, revealed), status: 'thinking' }, targetSessionId);
        await delay(LOCAL_ANSWER_STREAM_STEP_MS, signal);
      }

      updateMessage(id, { text }, targetSessionId);
    },
    [addMessage, updateMessage]
  );

  const addTraceMessage = useCallback((targetSessionId = activeSessionIdRef.current) => {
    const id = messageId('trace');
    mutateSessionSnapshot(targetSessionId, (snapshot) => ({
      ...snapshot,
      messages: [...snapshot.messages, { id, role: 'assistant', kind: 'trace', text: '', status: 'thinking', nodes: [] }]
    }));
    return id;
  }, [mutateSessionSnapshot]);

  const appendTraceNode = useCallback(
    (messageId: string, node: TraceNode, targetSessionId = activeSessionIdRef.current) => {
      mutateSessionSnapshot(targetSessionId, (snapshot) => ({
        ...snapshot,
        messages: snapshot.messages.map((message) =>
          message.id === messageId ? { ...message, nodes: [...(message.nodes ?? []), node] } : message
        )
      }));
    },
    [mutateSessionSnapshot]
  );

  const patchTraceNode = useCallback(
    (messageId: string, nodeId: string, patch: Partial<TraceNode>, targetSessionId = activeSessionIdRef.current) => {
      mutateSessionSnapshot(targetSessionId, (snapshot) => ({
        ...snapshot,
        messages: snapshot.messages.map((message) =>
          message.id === messageId
            ? {
                ...message,
                nodes: (message.nodes ?? []).map((node) => (node.id === nodeId ? { ...node, ...patch } : node))
              }
            : message
        )
      }));
    },
    [mutateSessionSnapshot]
  );

  const finishTraceMessage = useCallback(
    (messageId: string, targetSessionId = activeSessionIdRef.current) => {
      mutateSessionSnapshot(targetSessionId, (snapshot) => ({
        ...snapshot,
        messages: snapshot.messages.map((message) => (message.id === messageId ? { ...message, status: undefined } : message))
      }));
    },
    [mutateSessionSnapshot]
  );

  // 逐字打字 narration
  const playNarration = useCallback(
    async (traceId: string, text: string, signal?: AbortSignal, targetSessionId = activeSessionIdRef.current) => {
      const nodeId = messageId('node');
      appendTraceNode(traceId, { id: nodeId, type: 'narration', status: 'running', text, revealed: 0 }, targetSessionId);
      for (let i = 1; i <= text.length; i += 1) {
        patchTraceNode(traceId, nodeId, { revealed: i }, targetSessionId);
        await delay(TRACE_TYPING_CHAR_MS, signal);
      }
      patchTraceNode(traceId, nodeId, { status: 'done', revealed: text.length }, targetSessionId);
      await delay(TRACE_NARRATION_HOLD_MS, signal);
    },
    [appendTraceNode, patchTraceNode]
  );

  // 命令组：逐条出现 → 逐条完成
  const playCommands = useCallback(
    async (
      traceId: string,
      title: string,
      commands: TraceScriptCommand[],
      signal?: AbortSignal,
      targetSessionId = activeSessionIdRef.current
    ) => {
      const nodeId = messageId('node');
      const initial: TraceCommand[] = [];
      appendTraceNode(
        traceId,
        { id: nodeId, type: 'commands', status: 'running', text: '正在运行命令...', commands: initial },
        targetSessionId
      );
      const live: TraceCommand[] = [];
      for (const command of commands) {
        live.push({ text: command.text, status: 'running' });
        patchTraceNode(traceId, nodeId, { commands: live.map((entry) => ({ ...entry })) }, targetSessionId);
        await delay(TRACE_COMMAND_STEP_MS, signal);
        live[live.length - 1] = { text: command.text, result: command.result, status: 'done' };
        patchTraceNode(traceId, nodeId, { commands: live.map((entry) => ({ ...entry })) }, targetSessionId);
        await delay(Math.round(TRACE_COMMAND_STEP_MS * 0.4), signal);
      }
      patchTraceNode(traceId, nodeId, { status: 'done', text: title }, targetSessionId);
      await delay(TRACE_NARRATION_HOLD_MS, signal);
    },
    [appendTraceNode, patchTraceNode]
  );

  // 单个具名动作：spinner → ✓
  const playAction = useCallback(
    async (traceId: string, title: string, result: string, signal?: AbortSignal, targetSessionId = activeSessionIdRef.current) => {
      const nodeId = messageId('node');
      appendTraceNode(traceId, { id: nodeId, type: 'action', status: 'running', text: title }, targetSessionId);
      await delay(TRACE_ACTION_RUN_MS, signal);
      patchTraceNode(traceId, nodeId, { status: 'done', result }, targetSessionId);
      await delay(Math.round(TRACE_NARRATION_HOLD_MS * 0.7), signal);
    },
    [appendTraceNode, patchTraceNode]
  );

  // 文件编辑标记
  const playEdit = useCallback(
    async (traceId: string, text: string, signal?: AbortSignal, targetSessionId = activeSessionIdRef.current) => {
      const nodeId = messageId('node');
      appendTraceNode(traceId, { id: nodeId, type: 'edit', status: 'done', text }, targetSessionId);
      await delay(TRACE_EDIT_HOLD_MS, signal);
    },
    [appendTraceNode]
  );

  // 把一份脚本顺序播放进同一条 trace 消息
  const runPlanningTrace = useCallback(
    async (traceId: string, script: TraceScriptStep[], signal?: AbortSignal, targetSessionId = activeSessionIdRef.current) => {
      for (const step of script) {
        if (step.kind === 'narration') {
          await playNarration(traceId, step.text, signal, targetSessionId);
        } else if (step.kind === 'commands') {
          await playCommands(traceId, step.title, step.commands, signal, targetSessionId);
        } else if (step.kind === 'action') {
          await playAction(traceId, step.title, step.result, signal, targetSessionId);
        } else if (step.kind === 'edit') {
          await playEdit(traceId, step.text, signal, targetSessionId);
        }
      }
    },
    [playAction, playCommands, playEdit, playNarration]
  );

  // 外部模型调用也走时间线：叙述 intro → "调用 X 模型" action（spinner）→ 流式答案
  const runExternalModelTrace = useCallback(
    async (params: {
      modelRuntime: AgentModelRuntime & {
        apiKey: string;
        baseUrl: string;
        modelId: string;
      };
      introNarration: string;
      actionTitle: string;
      prompt: string;
      systemPrompt?: string;
      contextMessages?: CompleteChatMessage[];
      traceId?: string;
      finishTrace?: boolean;
      emitAnswer?: boolean;
      targetSessionId?: string;
      signal?: AbortSignal;
    }): Promise<{ status: 'ok'; answer: string } | { status: 'error'; message: string }> => {
      const targetSessionId = params.targetSessionId ?? activeSessionIdRef.current;
      const traceId = params.traceId ?? addTraceMessage(targetSessionId);
      const shouldFinishTrace = params.finishTrace ?? !params.traceId;
      const shouldEmitAnswer = params.emitAnswer !== false;
      try {
        await playNarration(traceId, params.introNarration, params.signal, targetSessionId);
      } catch (caught) {
        if (isAbortError(caught) || params.signal?.aborted) {
          if (shouldFinishTrace) finishTraceMessage(traceId, targetSessionId);
          return { status: 'error', message: '已停止生成。' };
        }
        throw caught;
      }

      const actionNodeId = messageId('node');
      appendTraceNode(traceId, { id: actionNodeId, type: 'action', status: 'running', text: params.actionTitle }, targetSessionId);

      let answerId: string | null = null;
      let streamedText = '';
      let reasoningNodeId: string | null = null;
      let reasoningText = '';
      let actionDone = false;
      const markActionDone = (result: string) => {
        if (actionDone) return;
        actionDone = true;
        patchTraceNode(traceId, actionNodeId, { status: 'done', result }, targetSessionId);
      };
      const appendReasoningDelta = (delta: string) => {
        if (!delta) return;
        reasoningText += delta;
        if (!reasoningNodeId) {
          reasoningNodeId = messageId('node');
          appendTraceNode(
            traceId,
            {
              id: reasoningNodeId,
              type: 'reasoning',
              status: 'running',
              text: reasoningText
            },
            targetSessionId
          );
          return;
        }
        patchTraceNode(traceId, reasoningNodeId, { text: reasoningText, status: 'running' }, targetSessionId);
      };
      const finishReasoningNode = () => {
        if (!reasoningNodeId) return;
        patchTraceNode(traceId, reasoningNodeId, { status: 'done' }, targetSessionId);
      };

      try {
        const answer = await completeConfiguredModelChat(
          params.prompt,
          params.modelRuntime,
          params.systemPrompt,
          params.contextMessages,
          (event) => {
            if (params.signal?.aborted) return;
            if (event.kind === 'assistant_reasoning_delta') {
              markActionDone('正在返回');
              appendReasoningDelta(event.text);
              return;
            }
            if (event.kind === 'completed') {
              finishReasoningNode();
              markActionDone('已返回');
              return;
            }
            if (event.kind !== 'assistant_text_delta') return;
            markActionDone('已返回');
            streamedText += event.text;
            if (!shouldEmitAnswer) return;
            if (!answerId) {
              answerId = addMessage('assistant', streamedText, 'thinking', targetSessionId);
            } else {
              updateMessage(answerId, { text: streamedText, status: 'thinking' }, targetSessionId);
            }
          },
          params.signal
        );
        if (params.signal?.aborted) {
          finishReasoningNode();
          markActionDone('已停止');
          if (shouldFinishTrace) finishTraceMessage(traceId, targetSessionId);
          return { status: 'error', message: '已停止生成。' };
        }
        finishReasoningNode();
        markActionDone('已返回');
        if (shouldFinishTrace) finishTraceMessage(traceId, targetSessionId);
        if (shouldEmitAnswer) {
          if (!answerId) {
            addMessage('assistant', answer, undefined, targetSessionId);
          } else {
            updateMessage(answerId, { text: answer }, targetSessionId);
          }
        }
        return { status: 'ok', answer };
      } catch (caught) {
        if (isAbortError(caught) || params.signal?.aborted) {
          finishReasoningNode();
          markActionDone('已停止');
          if (shouldFinishTrace) finishTraceMessage(traceId, targetSessionId);
          return { status: 'error', message: '已停止生成。' };
        }
        finishReasoningNode();
        markActionDone('调用失败');
        if (shouldFinishTrace) finishTraceMessage(traceId, targetSessionId);
        const message = formatModelError(caught);
        if (!answerId) {
          addMessage('assistant', message, undefined, targetSessionId);
        } else {
          updateMessage(answerId, { text: message }, targetSessionId);
        }
        return { status: 'error', message };
      }
    },
    [addMessage, addTraceMessage, appendTraceNode, finishTraceMessage, patchTraceNode, playNarration, updateMessage]
  );

  const updateRequirement = useCallback((value: string) => {
    mutateSessionSnapshot(activeSessionIdRef.current, (snapshot) => ({
      ...snapshot,
      requirement: value,
      plannedRequirement: null,
      pendingNormalizationRequirement: null,
      normalizationStatus: 'idle',
      plan: null,
      project: null
    }));
  }, [mutateSessionSnapshot]);

  const resetSession = useCallback(() => {
    // 不中止当前会话的任务，让它继续在后台运行
    // 只清理本地引用，因为这个 hook 实例即将切换到新 sessionId
    activeRunRef.current = null;
    const newSessionId = createSessionId();
    applySnapshotToActiveState(createEmptySessionSnapshot(newSessionId));
    return newSessionId;
  }, [applySnapshotToActiveState]);

  const createSnapshot = useCallback(
    (): AgentSessionSnapshot => {
      const snapshot = normalizeSnapshotForTaskState(currentSnapshotRef.current);
      sessionSnapshotsRef.current.set(snapshot.sessionId, snapshot);
      if (snapshot.sessionId === activeSessionIdRef.current) {
        currentSnapshotRef.current = snapshot;
      }
      return snapshot;
    },
    []
  );

  const restoreSnapshot = useCallback((snapshot: AgentSessionSnapshot) => {
    // 切换到其他会话时，只清理本地引用，不中止任何会话的任务
    activeRunRef.current = null;
    const cachedSnapshot = sessionSnapshotsRef.current.get(snapshot.sessionId) ?? snapshot;
    applySnapshotToActiveState(normalizeSnapshotForTaskState(cachedSnapshot));
  }, [applySnapshotToActiveState]);

  const cancelCurrentRun = useCallback(() => {
    // 使用全局任务管理器中止任务
    const cancelled = sessionTaskManager.cancelTask(sessionId);
    if (!cancelled) return;

    activeRunRef.current = null;
    mutateSessionSnapshot(sessionId, (snapshot) => ({
      ...snapshot,
      loading: 'idle',
      error: null,
      messages: snapshot.messages.map(finishRunningMessage)
    }));
    addMessage('system', '已停止生成。', undefined, sessionId);
  }, [addMessage, mutateSessionSnapshot, sessionId]);

  const generateValidatedAsm = useCallback(
    async (
      trimmedRequirement: string,
      options: {
        modelRuntime?: AgentModelRuntime;
        showTrace?: boolean;
        emitAnswer?: boolean;
        traceId?: string;
        traceScript?: TraceScriptStep[];
        handoffNodeId?: string;
        handoffResult?: string;
        targetSessionId?: string;
        signal?: AbortSignal;
      } = {}
    ): Promise<{ status: 'ready'; plan: GenerationPlan; file: GeneratedFile } | { status: 'needsInput' }> => {
      const targetSessionId = options.targetSessionId ?? activeSessionIdRef.current;
      const asmAgent = getAsmAgent();
      if (!asmAgent) {
        throw new Error('桥接 API 不可用，请确认 Electron preload 已注入。');
      }

      const planningOutcome = asmAgent
        .createPlan({
          chipId: CHIP_ID,
          requirement: trimmedRequirement
        })
        .then(
          (result) => ({ status: 'fulfilled' as const, result }),
          (caught) => ({ status: 'rejected' as const, caught })
        );

      const traceId = options.showTrace !== false ? options.traceId ?? addTraceMessage(targetSessionId) : null;
      if (traceId && options.handoffNodeId) {
        patchTraceNode(
          traceId,
          options.handoffNodeId,
          { status: 'done', result: options.handoffResult ?? '已进入本地规范化' },
          targetSessionId
        );
      }
      if (traceId) {
        await runPlanningTrace(
          traceId,
          options.traceScript ?? buildPlanningTrace(trimmedRequirement, options.modelRuntime),
          options.signal,
          targetSessionId
        );
      }
      if (options.signal?.aborted) {
        if (traceId) finishTraceMessage(traceId, targetSessionId);
        throw new DOMException('Aborted', 'AbortError');
      }

      const outcome = await planningOutcome;
      if (options.signal?.aborted) {
        if (traceId) finishTraceMessage(traceId, targetSessionId);
        throw new DOMException('Aborted', 'AbortError');
      }
      if (outcome.status === 'rejected') {
        if (traceId) finishTraceMessage(traceId, targetSessionId);
        throw outcome.caught;
      }

      const result: PlanResult = outcome.result;

      if (result.status === 'needsInput') {
        const questions = result.questions.join('；');
        mutateSessionSnapshot(targetSessionId, (snapshot) => ({ ...snapshot, error: null }));
        if (traceId) {
          await playNarration(
            traceId,
            `校验后发现信息还不够，目前还不能安全生成可验证 ASM。需要补充：${questions}`,
            options.signal,
            targetSessionId
          );
          finishTraceMessage(traceId, targetSessionId);
        } else {
          const id = addMessage('assistant', '正在整理需要补充的参数...', 'thinking', targetSessionId);
          await delay(SUPPLEMENTAL_PROMPT_DELAY_MS, options.signal);
          updateMessage(id, {
            text: `检查结果：目前还不能安全生成可验证 ASM。需要补充信息：${questions}`
          }, targetSessionId);
        }
        return { status: 'needsInput' };
      }

      mutateSessionSnapshot(targetSessionId, (snapshot) => ({
        ...snapshot,
        plan: result.plan,
        plannedRequirement: trimmedRequirement
      }));
      const spec = new BuiltInSpecRepository().getByChipId(result.plan.chipId);
      const file = new SingleAsmFileGenerator().generate({
        requirement: trimmedRequirement,
        plan: result.plan,
        spec
      });
      if (!asmAgent.saveAsmFile) {
        if (traceId) finishTraceMessage(traceId, targetSessionId);
        throw new Error('会话文件保存接口不可用，无法写入 main.asm。');
      }

      if (traceId) {
        await playNarration(
          traceId,
          `规范校验通过，正在把最终结果写入会话文件 \`${file.path}\`。`,
          options.signal,
          targetSessionId
        );
        await playEdit(traceId, `编辑了 ${file.path}`, options.signal, targetSessionId);
        await playNarration(traceId, '完成。下面给出生成的单文件 ASM 与规范自检结论。', options.signal, targetSessionId);
        finishTraceMessage(traceId, targetSessionId);
      }
      if (options.signal?.aborted) {
        if (traceId) finishTraceMessage(traceId, targetSessionId);
        throw new DOMException('Aborted', 'AbortError');
      }

      const savedFile = await asmAgent.saveAsmFile({
        sessionId: targetSessionId,
        file
      });
      if (options.signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      mutateSessionSnapshot(targetSessionId, (snapshot) => ({
        ...snapshot,
        asmFile: buildAsmFileMeta(file, savedFile)
      }));
      if (options.emitAnswer !== false) {
        addMessage('assistant', buildSingleAsmAnswer(file), undefined, targetSessionId);
      }
      return { status: 'ready', plan: result.plan, file };
    },
    [
      addMessage,
      addTraceMessage,
      finishTraceMessage,
      mutateSessionSnapshot,
      playEdit,
      playNarration,
      runPlanningTrace,
      updateMessage
    ]
  );

  const createPlan = useCallback(async (modelRuntime?: AgentModelRuntime) => {
    const runSessionId = sessionId;
    const trimmedRequirement = requirement.trim();
    const patchRunSession = (patch: Partial<AgentSessionSnapshot>) => {
      mutateSessionSnapshot(runSessionId, (snapshot) => ({ ...snapshot, ...patch }));
    };

    if (!trimmedRequirement) {
      const message = '请先描述 ASM 工程的目标功能，例如 Timer0 中断、GPIO 输出或 WDT 清狗。';
      patchRunSession({ error: message });
      addMessage('assistant', message, undefined, runSessionId);
      return;
    }

    // 使用全局任务管理器创建新任务
    const activeRun = sessionTaskManager.createTask(runSessionId);
    activeRunRef.current = activeRun;
    const isCurrentRun = () => sessionTaskManager.isCurrentTask(runSessionId, activeRun.id);

    const intent = classifyAssistantIntent(trimmedRequirement);
    patchRunSession({
      error: null,
      plan: null,
      project: null,
      asmFile: null,
      plannedRequirement: null,
      pendingNormalizationRequirement: null,
      normalizationStatus: 'idle',
      requirement: ''
    });
    addMessage('user', trimmedRequirement, undefined, runSessionId);
    const contextMessages = buildVisibleModelContext(messages, trimmedRequirement);

    if (intent === 'ordinaryChat') {
      if (canUseExternalModel(modelRuntime)) {
        patchRunSession({ loading: 'planning' });
        try {
          await runExternalModelTrace({
            modelRuntime,
            introNarration: `收到问题，我把它发给 ${modelRuntime.label} 来回答。`,
            actionTitle: `调用 ${modelRuntime.label} 模型`,
            prompt: trimmedRequirement,
            contextMessages,
            targetSessionId: runSessionId,
            signal: activeRun.controller.signal
          });
        } finally {
          if (sessionTaskManager.isCurrentTask(runSessionId, activeRun.id)) {
            sessionTaskManager.completeTask(runSessionId, activeRun.id);
            activeRunRef.current = null;
            patchRunSession({ loading: 'idle' });
          }
        }
      } else {
        addMessage('assistant', buildOrdinaryChatResponse(trimmedRequirement, modelRuntime), undefined, runSessionId);
        sessionTaskManager.completeTask(runSessionId, activeRun.id);
        activeRunRef.current = null;
      }
      return;
    }

    if (intent === 'asmHelp') {
      if (canUseExternalModel(modelRuntime)) {
        patchRunSession({ loading: 'planning' });
        try {
          await runExternalModelTrace({
            modelRuntime,
            introNarration: `这是 ASM 相关咨询，我让 ${modelRuntime.label} 结合 HK64S8x 规范来分析，结论仍以内置规范为准。`,
            actionTitle: `调用 ${modelRuntime.label} 分析 ASM 问题`,
            prompt: trimmedRequirement,
            systemPrompt: buildSpecDrivenAsmSystemPrompt(buildAsmModelAnalysisSystemPrompt(modelRuntime)),
            contextMessages,
            targetSessionId: runSessionId,
            signal: activeRun.controller.signal
          });
        } finally {
          if (sessionTaskManager.isCurrentTask(runSessionId, activeRun.id)) {
            sessionTaskManager.completeTask(runSessionId, activeRun.id);
            activeRunRef.current = null;
            patchRunSession({ loading: 'idle' });
          }
        }
      } else {
        addMessage('assistant', buildAsmHelpResponse(trimmedRequirement), undefined, runSessionId);
        sessionTaskManager.completeTask(runSessionId, activeRun.id);
        activeRunRef.current = null;
      }
      return;
    }

    if (intent === 'unclearGeneration') {
      addMessage('assistant', buildUnclearGenerationResponse(), undefined, runSessionId);
      sessionTaskManager.completeTask(runSessionId, activeRun.id);
      activeRunRef.current = null;
      return;
    }

    if (canUseExternalModel(modelRuntime)) {
      patchRunSession({ loading: 'planning' });
      try {
        const asmAgent = getAsmAgent();
        if (!asmAgent) {
          throw new Error('桥接 API 不可用，请确认 Electron preload 已注入。');
        }
        const traceId = addTraceMessage(runSessionId);
        const result = await runExternalModelTrace({
          modelRuntime,
          introNarration: `收到工程生成需求。我会带完整 HK64S8x JSON 规范约束和用户需求一起传给 ${modelRuntime.label}，让模型直接生成 ASM；返回后只做本地质检，不再本地改写。`,
          actionTitle: `调用 ${modelRuntime.label} 生成成品 ASM`,
          prompt: buildAsmModelGenerationPrompt(trimmedRequirement),
          systemPrompt: buildSpecDrivenAsmSystemPrompt(buildAsmModelGenerationSystemPrompt(modelRuntime)),
          contextMessages,
          traceId,
          finishTrace: false,
          emitAnswer: false,
          targetSessionId: runSessionId,
          signal: activeRun.controller.signal
        });
        if (!isCurrentRun()) return;
        if (result.status === 'ok') {
          const spec = new BuiltInSpecRepository().getByChipId(CHIP_ID);
          let modelResponse = result.answer;
          let handoffNodeId = appendRunningActionNode(
            appendTraceNode,
            traceId,
            '质检模型返回 ASM',
            runSessionId
          );
          let file: GeneratedFile | null = null;

          for (let repairAttempt = 0; ; repairAttempt += 1) {
            try {
              file = buildModelAsmGeneratedFile({
                modelResponse,
                requirement: trimmedRequirement,
                spec
              });
              patchTraceNode(
                traceId,
                handoffNodeId,
                { status: 'done', result: repairAttempt === 0 ? '通过' : '修复后 ASM 通过' },
                runSessionId
              );
              break;
            } catch (caught) {
              const validationMessage = caught instanceof Error ? caught.message : String(caught);
              patchTraceNode(
                traceId,
                handoffNodeId,
                {
                  status: 'done',
                  result: repairAttempt < MODEL_ASM_REPAIR_ATTEMPTS ? '质检失败，准备重试' : '质检失败'
                },
                runSessionId
              );

              if (repairAttempt >= MODEL_ASM_REPAIR_ATTEMPTS) {
                finishTraceMessage(traceId, runSessionId);
                throw caught;
              }

              const repairResult = await runExternalModelTrace({
                modelRuntime,
                introNarration:
                  '本地质量闸发现模型 ASM 仍含有规范外语法。我会把质检诊断和完整 JSON 规范约束一起反馈给模型，让它重新生成 ASM。',
                actionTitle: '带诊断重新生成 ASM',
                prompt: buildAsmModelRepairPrompt(trimmedRequirement, modelResponse, validationMessage),
                systemPrompt: buildSpecDrivenAsmSystemPrompt(buildAsmModelGenerationSystemPrompt(modelRuntime)),
                contextMessages,
                traceId,
                finishTrace: false,
                emitAnswer: false,
                targetSessionId: runSessionId,
                signal: activeRun.controller.signal
              });

              if (!isCurrentRun()) return;
              if (repairResult.status !== 'ok') {
                finishTraceMessage(traceId, runSessionId);
                throw new Error(repairResult.message);
              }

              modelResponse = repairResult.answer;
              handoffNodeId = appendRunningActionNode(
                appendTraceNode,
                traceId,
                '复检模型返回 ASM',
                runSessionId
              );
            }
          }

          if (!file) {
            finishTraceMessage(traceId, runSessionId);
            throw new Error('模型未返回可保存的合格 ASM。');
          }

          if (!asmAgent.saveAsmFile) {
            finishTraceMessage(traceId, runSessionId);
            throw new Error('会话文件保存接口不可用，无法写入 main.asm。');
          }
          await runPlanningTrace(traceId, buildPostModelValidationTrace(modelRuntime), activeRun.controller.signal, runSessionId);
          await playNarration(
            traceId,
            `模型生成的 ASM 已通过本地规范校验，正在把最终结果写入会话文件 \`${file.path}\`。`,
            activeRun.controller.signal,
            runSessionId
          );
          await playEdit(traceId, `编辑了 ${file.path}`, activeRun.controller.signal, runSessionId);
          await playNarration(traceId, '完成。下面给出模型直出并通过质检的单文件 ASM。', activeRun.controller.signal, runSessionId);
          finishTraceMessage(traceId, runSessionId);
          if (activeRun.controller.signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }
          const savedFile = await asmAgent.saveAsmFile({
            sessionId: runSessionId,
            file
          });
          if (activeRun.controller.signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }
          patchRunSession({
            asmFile: buildAsmFileMeta(file, savedFile),
            pendingNormalizationRequirement: null,
            normalizationStatus: 'validated'
          });
          addMessage('assistant', buildSingleAsmAnswer(file), undefined, runSessionId);
        } else {
          finishTraceMessage(traceId, runSessionId);
          patchRunSession({ normalizationStatus: 'failed' });
        }
      } catch (caught) {
        if (isAbortError(caught) || activeRun.controller.signal.aborted) {
          return;
        }
        const message = caught instanceof Error ? caught.message : '生成计划失败。';
        patchRunSession({ normalizationStatus: 'failed', error: message });
        addMessage('system', message, undefined, runSessionId);
      } finally {
        if (sessionTaskManager.isCurrentTask(runSessionId, activeRun.id)) {
          sessionTaskManager.completeTask(runSessionId, activeRun.id);
          activeRunRef.current = null;
          patchRunSession({ loading: 'idle' });
        }
      }
      return;
    }

    patchRunSession({ loading: 'planning' });

    try {
      const result = await generateValidatedAsm(trimmedRequirement, {
        modelRuntime,
        targetSessionId: runSessionId,
        signal: activeRun.controller.signal
      });
      if (!isCurrentRun()) return;
      patchRunSession({ normalizationStatus: result.status === 'ready' ? 'validated' : 'idle' });
    } catch (caught) {
      if (isAbortError(caught) || activeRun.controller.signal.aborted) {
        return;
      }
      const message = caught instanceof Error ? caught.message : '生成计划失败。';
      patchRunSession({ normalizationStatus: 'failed', error: message });
      addMessage('system', message, undefined, runSessionId);
    } finally {
      if (sessionTaskManager.isCurrentTask(runSessionId, activeRun.id)) {
        sessionTaskManager.completeTask(runSessionId, activeRun.id);
        activeRunRef.current = null;
        patchRunSession({ loading: 'idle' });
      }
    }
  }, [
    addMessage,
    addTraceMessage,
    finishTraceMessage,
    generateValidatedAsm,
    messages,
    mutateSessionSnapshot,
    requirement,
    runExternalModelTrace,
    sessionId
  ]);

  const normalizeAsm = useCallback(async (sourceCode?: string) => {
    const runSessionId = sessionId;
    const patchRunSession = (patch: Partial<AgentSessionSnapshot>) => {
      mutateSessionSnapshot(runSessionId, (snapshot) => ({ ...snapshot, ...patch }));
    };
    const trimmedRequirement =
      pendingNormalizationRequirement ?? plannedRequirement ?? buildNormalizationRequirementFromSource(sourceCode);
    if (!trimmedRequirement) {
      const message = '请先生成一段可规范化的 ASM 代码。';
      patchRunSession({ error: message });
      addMessage('system', message, undefined, runSessionId);
      return;
    }

    // 使用全局任务管理器创建新任务
    const activeRun = sessionTaskManager.createTask(runSessionId);
    activeRunRef.current = activeRun;
    const isCurrentRun = () => sessionTaskManager.isCurrentTask(runSessionId, activeRun.id);

    patchRunSession({
      loading: 'generating',
      error: null,
      normalizationStatus: 'normalizing'
    });

    try {
      const result = await generateValidatedAsm(trimmedRequirement, {
        emitAnswer: false,
        targetSessionId: runSessionId,
        signal: activeRun.controller.signal
      });
      if (!isCurrentRun()) return;
      if (result.status === 'ready') {
        await streamAssistantAnswer(buildSingleAsmAnswer(result.file), activeRun.controller.signal, runSessionId);
        if (!isCurrentRun()) return;
        patchRunSession({
          pendingNormalizationRequirement: null,
          normalizationStatus: 'validated'
        });
      } else {
        patchRunSession({ normalizationStatus: 'failed' });
      }
    } catch (caught) {
      if (isAbortError(caught) || activeRun.controller.signal.aborted) {
        return;
      }
      const message = caught instanceof Error ? caught.message : '规范化 ASM 失败。';
      patchRunSession({ normalizationStatus: 'failed', error: message });
      addMessage('system', message, undefined, runSessionId);
    } finally {
      if (sessionTaskManager.isCurrentTask(runSessionId, activeRun.id)) {
        sessionTaskManager.completeTask(runSessionId, activeRun.id);
        activeRunRef.current = null;
        patchRunSession({ loading: 'idle' });
      }
    }
  }, [
    addMessage,
    generateValidatedAsm,
    mutateSessionSnapshot,
    pendingNormalizationRequirement,
    plannedRequirement,
    sessionId,
    streamAssistantAnswer
  ]);

  const generateProject = useCallback(async () => {
    const runSessionId = sessionId;
    const patchRunSession = (patch: Partial<AgentSessionSnapshot>) => {
      mutateSessionSnapshot(runSessionId, (snapshot) => ({ ...snapshot, ...patch }));
    };
    const trimmedRequirement = plannedRequirement;
    if (!plan || !plannedRequirement) {
      patchRunSession({ error: '请先生成计划。' });
      return;
    }

    if (trimmedRequirement !== plannedRequirement) {
      patchRunSession({
        error: '需求已变化，请重新生成计划后再生成工程。',
        plan: null,
        project: null,
        plannedRequirement: null
      });
      return;
    }

    const asmAgent = getAsmAgent();
    if (!asmAgent) {
      patchRunSession({ error: '桥接 API 不可用，请确认 Electron preload 已注入。' });
      return;
    }

    patchRunSession({ loading: 'generating', error: null });

    try {
      const generatedProject = await asmAgent.generateProject({
        projectName: buildProjectName(plannedRequirement),
        requirement: plannedRequirement,
        plan
      });

      patchRunSession({ project: generatedProject });
      addMessage('assistant', `已生成工程：${generatedProject.projectName}`, undefined, runSessionId);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '生成工程失败。';
      patchRunSession({ error: message });
      addMessage('system', message, undefined, runSessionId);
    } finally {
      patchRunSession({ loading: 'idle' });
    }
  }, [addMessage, mutateSessionSnapshot, plan, plannedRequirement, sessionId]);

  const openAsmFile = useCallback(async () => {
    const runSessionId = sessionId;
    const patchRunSession = (patch: Partial<AgentSessionSnapshot>) => {
      mutateSessionSnapshot(runSessionId, (snapshot) => ({ ...snapshot, ...patch }));
    };

    if (!asmFile?.absolutePath) {
      patchRunSession({ error: '尚未保存可打开的 ASM 文件。' });
      return;
    }

    const asmAgent = getAsmAgent();
    if (!asmAgent?.openFile) {
      patchRunSession({ error: '会话文件打开接口不可用。' });
      return;
    }

    try {
      await asmAgent.openFile({ path: asmFile.absolutePath });
      patchRunSession({ error: null });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '打开 ASM 文件失败。';
      patchRunSession({ error: message });
      addMessage('system', message, undefined, runSessionId);
    }
  }, [addMessage, asmFile, mutateSessionSnapshot, sessionId]);

  const canGenerateProject = Boolean(plan && plannedRequirement) && loading === 'idle';
  const canNormalizeAsm = Boolean(pendingNormalizationRequirement) && loading === 'idle';

  return useMemo(
    () => ({
      sessionId,
      chipId: CHIP_ID,
      apiVersion,
      isBridgeReady,
      requirement,
      plan,
      project,
      asmFile,
      canGenerateProject,
      pendingNormalizationRequirement,
      normalizationStatus,
      canNormalizeAsm,
      messages,
      loading,
      error,
      setRequirement: updateRequirement,
      createPlan,
      cancelCurrentRun,
      generateProject,
      normalizeAsm,
      openAsmFile,
      resetSession,
      createSnapshot,
      restoreSnapshot
    }),
    [
      apiVersion,
      asmFile,
      canGenerateProject,
      canNormalizeAsm,
      cancelCurrentRun,
      createSnapshot,
      createPlan,
      error,
      generateProject,
      isBridgeReady,
      loading,
      messages,
      normalizeAsm,
      normalizationStatus,
      openAsmFile,
      pendingNormalizationRequirement,
      plan,
      project,
      requirement,
      resetSession,
      restoreSnapshot,
      sessionId,
      updateRequirement
    ]
  );
}
