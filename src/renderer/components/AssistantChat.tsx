import { useEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type SetStateAction } from 'react';

import { MarkdownMessage } from './MarkdownMessage';
import { AgentTrace } from './AgentTrace';
import type { AgentModelRuntime, AgentSessionState } from '../state/useAgentSession';
import {
  getCustomModelDisplayName,
  getModelLabel,
  getSelectedModelConfig,
  isCompleteModelConfig,
  MODEL_OPTIONS,
  type CustomModelConfig,
  type ModelConfigState,
  type ModelProvider
} from '../state/modelConfig';

interface AssistantChatProps {
  session: AgentSessionState;
  modelConfigState: ModelConfigState;
  onModelConfigStateChange: Dispatch<SetStateAction<ModelConfigState>>;
}
const COMPOSER_MODEL_MENU_ID = 'composer-model-menu';
const AUTO_SCROLL_BOTTOM_THRESHOLD = 48;

interface ComposerModelOption {
  key: string;
  label: string;
  provider: ModelProvider;
  customModelId?: string;
}

function isNearMessageListBottom(list: HTMLDivElement): boolean {
  return list.scrollHeight - list.clientHeight - list.scrollTop <= AUTO_SCROLL_BOTTOM_THRESHOLD;
}

function providerConfigFromCustomModel(model: CustomModelConfig) {
  return {
    apiKey: model.apiKey,
    baseUrl: model.baseUrl,
    modelId: model.modelId
  };
}

function buildComposerModelOptions(state: ModelConfigState): ComposerModelOption[] {
  const builtInOptions = MODEL_OPTIONS.filter((option) => option.value !== 'custom').map((option) => ({
    key: option.value,
    label: option.label,
    provider: option.value
  }));

  if (state.customModels.length === 0) {
    return [
      ...builtInOptions,
      {
        key: 'custom',
        label: getModelLabel('custom'),
        provider: 'custom'
      }
    ];
  }

  return [
    ...builtInOptions,
    ...state.customModels.map((model, index) => ({
      key: `custom:${model.id}`,
      label: getCustomModelDisplayName(model, index),
      provider: 'custom' as const,
      customModelId: model.id
    }))
  ];
}

const EXAMPLE_PROMPTS: Array<{ title: string; detail: string; prompt: string; icon: string; accent: string }> = [
  {
    title: 'Timer0 精确定时中断',
    detail: '输出可质检的 Timer0/PA0 中断骨架，时序参数先保留注释。',
    prompt:
      '基于 HK64S8x 输出一个可通过内置 parseAsm + validateAsm 的最小单文件 ASM，请直接返回一个 asm 代码块，不要输出解释文本。只使用规范确认的指令和寄存器，不要编造未确认寄存器、位字段、向量或伪指令。场景：Timer0，FOSC 16MHz、8 分频、1ms 周期溢出中断，并在中断里翻转 PA0；这些硬件时序和翻转动作先写成 ; 注释。代码结构包含 reset_entry、main_entry、main_loop、timer0_init、interrupt_entry；主循环使用 CLRWDT + JMP main_loop，interrupt_entry 使用 CLRWDT + RETI。',
    icon: 'icons/07_external_interrupt_icon.jpg',
    accent: 'blue'
  },
  {
    title: 'GPIO 输出控制',
    detail: '仅用 PA_OE/PA_PIO 演示 PA0 输出高电平。',
    prompt:
      '基于 HK64S8x 输出一个可通过内置 parseAsm + validateAsm 的最小单文件 ASM，请直接返回一个 asm 代码块，不要输出解释文本。只使用规范确认的指令和寄存器，不要编造未确认寄存器、位字段、向量或伪指令。场景：PA0 推挽输出并输出高电平驱动 LED；GPIO 初始化只允许使用 PA_OE 和 PA_PIO 示例写法：MOV A,#0xFF / MOV PA_OE,A / MOV A,#0x01 / MOV PA_PIO,A。代码结构包含 reset_entry、main_entry、main_loop、gpio_init；主循环使用 CLRWDT + JMP main_loop。',
    icon: 'icons/08_watchdog_flow_icon.jpg',
    accent: 'green'
  },
  {
    title: '外部中断响应',
    detail: '输出可质检的 PA1 外部中断骨架，边沿和清标志先注释。',
    prompt:
      '基于 HK64S8x 输出一个可通过内置 parseAsm + validateAsm 的最小外部中断 ASM 骨架，请直接返回一个 asm 代码块，不要输出解释文本。只使用规范确认的指令和寄存器，不要编造未确认寄存器、位字段、向量或伪指令。场景：PA1 外部中断输入，下降沿触发，进入中断服务程序后清除中断标志位；下降沿触发和清标志位的具体寄存器/位字段如果 SPEC_DRIVEN_ASM_CONTEXT 未确认，只写成 ; 注释。代码结构包含 reset_entry、main_entry、main_loop、interrupt_entry；interrupt_entry 使用 CLRWDT + RETI。',
    icon: 'icons/06_gpio_output_icon.jpg',
    accent: 'violet'
  },
  {
    title: '看门狗清狗流程',
    detail: '用 CLRWDT 构建最小清狗循环，使能和周期参数先注释。',
    prompt:
      '基于 HK64S8x 输出一个可通过内置 parseAsm + validateAsm 的最小 WDT 清狗 ASM，请直接返回一个 asm 代码块，不要输出解释文本。只使用规范确认的指令和寄存器，不要编造未确认寄存器、位字段、向量或伪指令。场景：使能看门狗 WDT，并在主循环中按规范周期执行清狗指令防止系统复位；WDT 使能和周期配置如果 SPEC_DRIVEN_ASM_CONTEXT 未确认，只写成 ; 注释。代码结构包含 reset_entry、main_entry、main_loop、wdt_service；main_loop 和 wdt_service 使用 CLRWDT。',
    icon: 'icons/05_timer_icon.jpg',
    accent: 'red'
  }
];

export function AssistantChat({ session, modelConfigState, onModelConfigStateChange }: AssistantChatProps) {
  const isPlanning = session.loading === 'planning';
  const isGenerating = session.loading === 'generating';
  const canSend = !isPlanning && !isGenerating && session.requirement.trim().length > 0;
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const modelPickerRef = useRef<HTMLDivElement | null>(null);
  const modelConfig = getSelectedModelConfig(modelConfigState);
  const isApiConfigured = isCompleteModelConfig(modelConfig);
  const composerModelOptions = useMemo(() => buildComposerModelOptions(modelConfigState), [modelConfigState]);
  const selectedComposerModelKey =
    modelConfig.provider === 'custom' && modelConfig.customModelId ? `custom:${modelConfig.customModelId}` : modelConfig.provider;
  const selectedComposerModelOption = composerModelOptions.find((option) => option.key === selectedComposerModelKey);
  const modelPickerDisplay =
    selectedComposerModelOption?.label ??
    (modelConfig.provider === 'custom' && modelConfig.name?.trim() ? modelConfig.name.trim() : getModelLabel(modelConfig.provider));

  useEffect(() => {
    const list = messageListRef.current;
    if (!list) return;
    if (!shouldAutoScrollRef.current) return;
    list.scrollTop = list.scrollHeight;
  }, [session.messages]);

  const handleMessageListScroll = () => {
    const list = messageListRef.current;
    if (!list) return;
    shouldAutoScrollRef.current = isNearMessageListBottom(list);
  };

  useEffect(() => {
    if (!isModelMenuOpen) return;

    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && modelPickerRef.current?.contains(target)) return;
      setIsModelMenuOpen(false);
    };

    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, [isModelMenuOpen]);

  const submitRequirement = () => {
    if (!canSend) return;
    const modelRuntime: AgentModelRuntime = {
      provider: modelConfig.provider,
      label: getModelLabel(modelConfig.provider),
      isConfigured: isApiConfigured,
      apiKey: modelConfig.apiKey,
      baseUrl: modelConfig.baseUrl,
      modelId: modelConfig.modelId
    };
    void session.createPlan(modelRuntime);
  };

  const handleComposerSubmit = () => {
    if (isPlanning || isGenerating) {
      session.cancelCurrentRun();
      return;
    }

    submitRequirement();
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    submitRequirement();
  };

  const showWelcome = session.messages.length <= 1 && session.messages.every((message) => message.id === 'system-ready');

  const applyExamplePrompt = (prompt: string) => {
    session.setRequirement(prompt);
  };

  const focusComposerModelOption = (optionKey: string) => {
    window.setTimeout(() => {
      const optionButtons = Array.from(
        modelPickerRef.current?.querySelectorAll<HTMLButtonElement>('[data-model-option-key]') ?? []
      );
      optionButtons.find((button) => button.dataset.modelOptionKey === optionKey)?.focus();
    }, 0);
  };

  const openComposerModelMenu = () => {
    setIsModelMenuOpen(true);
    focusComposerModelOption(selectedComposerModelKey);
  };

  const selectComposerModel = (option: ComposerModelOption) => {
    onModelConfigStateChange((current) => {
      if (option.provider !== 'custom') {
        return {
          ...current,
          selectedProvider: option.provider
        };
      }

      const selectedModel = current.customModels.find((model) => model.id === option.customModelId) ?? current.customModels[0];
      if (!selectedModel) {
        return {
          ...current,
          selectedProvider: 'custom',
          selectedCustomModelId: null
        };
      }

      return {
        ...current,
        selectedProvider: 'custom',
        selectedCustomModelId: selectedModel.id,
        configs: {
          ...current.configs,
          custom: providerConfigFromCustomModel(selectedModel)
        }
      };
    });
    setIsModelMenuOpen(false);
  };

  const handleComposerModelButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault();
      openComposerModelMenu();
      return;
    }

    if (event.key === 'Escape') {
      setIsModelMenuOpen(false);
    }
  };

  const moveComposerModelFocus = (optionKey: string, direction: 1 | -1) => {
    const currentIndex = composerModelOptions.findIndex((option) => option.key === optionKey);
    const normalizedCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (normalizedCurrentIndex + direction + composerModelOptions.length) % composerModelOptions.length;
    focusComposerModelOption(composerModelOptions[nextIndex].key);
  };

  const handleComposerModelOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, option: ComposerModelOption) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveComposerModelFocus(option.key, 1);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveComposerModelFocus(option.key, -1);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setIsModelMenuOpen(false);
      modelPickerRef.current?.querySelector<HTMLButtonElement>('.model-picker')?.focus();
    }
  };

  return (
    <section className="panel assistant-panel" aria-label="ASM 汇编工程生成智能体">
      <header className="chat-topbar">
        <nav className="chat-breadcrumb" aria-label="位置">
          <span className="crumb">首页</span>
          <span className="crumb-sep" aria-hidden="true">/</span>
          <span className="crumb current">自然语言到 ASM 工程</span>
        </nav>
        <div className="chat-topbar-actions">
          <div className="topbar-utility-actions">
            <span className="topbar-version">
              {session.apiVersion ? (session.apiVersion.startsWith('v') ? session.apiVersion : `v${session.apiVersion}`) : 'v0.0.3'}
            </span>
          </div>
        </div>
      </header>

      <div className="message-list" aria-live="polite" ref={messageListRef} onScroll={handleMessageListScroll}>
        {showWelcome ? (
          <div className="chat-welcome">
            <section className="hero">
              <div className="hero-copy">
                <span className="hero-badge">ASM 工程生成智能体</span>
                <h1 className="hero-title">
                  自然语言到
                  <br />
                  <span className="hero-title-accent">HK64S8x</span> ASM 工程
                </h1>
                <p className="hero-subtitle">
                  基于航顺芯片 HK64S8x 处理器架构，将自然语言需求智能转化为规范、可编译、可部署的 ASM 工程。
                </p>
              </div>
              <div className="hero-art" aria-hidden="true">
                <img src="icons/03_chip_hero_render.jpg" alt="" />
              </div>
            </section>

            <section className="quick-start">
              <div className="quick-start-title">快速开始</div>
              <div className="quick-start-grid">
                {EXAMPLE_PROMPTS.map((example) => (
                  <button
                    type="button"
                    className={`prompt-card accent-${example.accent}`}
                    key={example.title}
                    onClick={() => applyExamplePrompt(example.prompt)}
                  >
                    <span className="prompt-card-icon" aria-hidden="true">
                      <img src={example.icon} alt="" />
                    </span>
                    <strong>{example.title}</strong>
                    <span className="prompt-card-detail">{example.detail}</span>
                    <span className="prompt-card-arrow" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>
          </div>
        ) : (
          session.messages.map((message) => {
            if (message.kind === 'trace') {
              return (
                <article className="trace-bubble" aria-label="智能体执行过程" key={message.id}>
                  <AgentTrace nodes={message.nodes ?? []} />
                </article>
              );
            }

            return (
              <article className={`message-bubble ${message.role}${message.status === 'thinking' ? ' thinking' : ''}`} key={message.id}>
                <span>{message.role === 'user' ? '需求' : message.role === 'system' ? '系统' : '智能体'}</span>
                {message.role === 'user' ? (
                  <p>
                    {message.text}
                    {message.status === 'thinking' ? <span className="typing-dots" aria-hidden="true" /> : null}
                  </p>
                ) : (
                  <div className="message-content">
                    <MarkdownMessage
                      text={message.text}
                      onNormalizeCode={message.role === 'assistant' ? (code) => void session.normalizeAsm(code) : undefined}
                    />
                    {message.status === 'thinking' ? <span className="typing-dots" aria-hidden="true" /> : null}
                  </div>
                )}
              </article>
            );
          })
        )}
      </div>

      <form
        className="requirement-form agent-composer"
        onSubmit={(event) => {
          event.preventDefault();
          handleComposerSubmit();
        }}
      >
        <label className="sr-only" htmlFor="asm-requirement">
          ASM 功能需求
        </label>
        <textarea
          id="asm-requirement"
          value={session.requirement}
          onChange={(event) => session.setRequirement(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          placeholder="描述 ASM 需求或后续变更，例如：实现串口接收中断，接收数据存入 RAM 缓冲区，接收完成后设置标志位..."
          rows={4}
        />
        <div className="composer-footer">
          <div className="composer-tools">
            <div className="model-picker-wrap" ref={modelPickerRef}>
              <button
                className="model-picker"
                type="button"
                aria-label="选择模型"
                aria-haspopup="listbox"
                aria-expanded={isModelMenuOpen}
                aria-controls={COMPOSER_MODEL_MENU_ID}
                onClick={() => {
                  if (isModelMenuOpen) {
                    setIsModelMenuOpen(false);
                    return;
                  }
                  openComposerModelMenu();
                }}
                onKeyDown={handleComposerModelButtonKeyDown}
              >
                <span className="model-picker-label">模型</span>
                <span className="model-picker-display">{modelPickerDisplay}</span>
              </button>
              {isModelMenuOpen ? (
                <div className="model-picker-menu" id={COMPOSER_MODEL_MENU_ID} role="listbox" aria-label="选择模型">
                  {composerModelOptions.map((option) => {
                    const isSelected = option.key === selectedComposerModelKey;
                    return (
                      <button
                        className={`model-picker-option${isSelected ? ' selected' : ''}`}
                        data-custom-model-id={option.customModelId}
                        data-model-option-key={option.key}
                        data-model-provider={option.provider}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        key={option.key}
                        onClick={() => selectComposerModel(option)}
                        onKeyDown={(event) => handleComposerModelOptionKeyDown(event, option)}
                      >
                        <span className="model-option-label">{option.label}</span>
                        {isSelected ? <span className="model-option-check" aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <button className="composer-tool" type="button">
              <img className="composer-tool-icon" src="icons/upload_file_restored.svg" alt="" aria-hidden="true" />
              上传文件
            </button>
            <button className="composer-tool" type="button">
              <img className="composer-tool-icon" src="icons/add_reference_restored.svg" alt="" aria-hidden="true" />
              添加参考
            </button>
            <button className="composer-tool" type="button">
              <img className="composer-tool-icon" src="icons/instruction_set_restored.svg" alt="" aria-hidden="true" />
              指令集
            </button>
          </div>
          <div className="composer-actions">
            <span className={`model-config-status ${isApiConfigured ? 'ready' : ''}`}>
              {modelConfig.provider === 'local' ? '本地模式' : isApiConfigured ? 'API 已配置' : 'API 未完整配置'}
            </span>
            {isPlanning || isGenerating ? (
              <button className="send-button stop-button" type="button" aria-label="停止生成" onClick={handleComposerSubmit}>
                <span className="stop-glyph" aria-hidden="true" />
              </button>
            ) : (
              <button className="send-button" type="submit" aria-label="发送需求" disabled={!canSend}>
                <img className="send-glyph" src="icons/21_send_reference.png" alt="" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </form>

    </section>
  );
}
