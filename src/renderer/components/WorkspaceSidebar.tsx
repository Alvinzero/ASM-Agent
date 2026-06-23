import { useEffect, useMemo, useState, type Dispatch, type FormEvent, type MouseEvent, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';

import type { AuthUserProfile } from '../../shared/auth/UserAuthTypes';
import type { AssistantMessage } from '../state/useAgentSession';
import {
  buildChatEndpointPreview,
  buildProviderConfigHint,
  createBlankCustomModel,
  getEditableModelConfig,
  MODEL_OPTIONS,
  type CustomModelConfig,
  type ModelApiConfig,
  type ModelConfigState,
  type ProviderApiConfig,
  type ModelProvider
} from '../state/modelConfig';
import { sessionTaskManager } from '../state/SessionTaskManager';

export interface ArchivedConversation {
  id: string;
  title: string;
  meta?: string;
  filePath?: string;
}

interface WorkspaceSidebarProps {
  chipId: string;
  sessionId: string;
  messages: AssistantMessage[];
  currentFilePath: string;
  archivedConversations: ArchivedConversation[];
  conversationOrder: string[];
  modelConfigState: ModelConfigState;
  onModelConfigStateChange: Dispatch<SetStateAction<ModelConfigState>>;
  activeNav: PrimaryNavId;
  onNavigate: (navId: PrimaryNavId) => void;
  onNewSession: () => void;
  onSelectConversation: (conversationId: string) => void;
  currentUser: AuthUserProfile;
  onLogout: () => void;
}

interface ConversationItem {
  id: string;
  title: string;
  meta: string;
  filePath: string;
  pinned: boolean;
  isCurrent: boolean;
  deleted?: boolean;
}

interface ConversationSessionMeta {
  title?: string;
  pinned?: boolean;
  deleted?: boolean;
}

interface ConversationStore {
  sessions: Record<string, ConversationSessionMeta>;
}

interface ContextMenuState {
  conversationId: string;
  x: number;
  y: number;
}

interface RenameState {
  conversationId: string;
  value: string;
}

type SettingsSection = 'general' | 'model' | 'about';
export type PrimaryNavId = 'home' | 'engineering' | 'knowledge' | 'demo' | 'toolbox';

interface ModelConfigDraftState {
  provider: ModelProvider;
  configs: Record<ModelProvider, ProviderApiConfig>;
  customModels: CustomModelConfig[];
  selectedCustomModelId: string | null;
}

const CONVERSATION_ACTIONS_KEY = 'asm-agent-conversation-actions';
const DEFAULT_OUTPUT_FILE_PATH = 'main.asm';

const PRIMARY_NAV: Array<{ id: PrimaryNavId; label: string; icon: string }> = [
  { id: 'home', label: '首页', icon: 'icons/15_nav_home.svg' },
  { id: 'engineering', label: '工程生成', icon: 'icons/16_nav_engineering.svg' },
  { id: 'knowledge', label: '知识库', icon: 'icons/17_nav_knowledge.svg' },
  { id: 'demo', label: '示例中心', icon: 'icons/18_nav_demo_center.svg' },
  { id: 'toolbox', label: '工具箱', icon: 'icons/19_nav_toolbox.svg' }
];

function readConversationStore(): ConversationStore {
  if (typeof window === 'undefined') return { sessions: {} };

  try {
    const parsed = JSON.parse(window.localStorage.getItem(CONVERSATION_ACTIONS_KEY) ?? '{}') as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { sessions: {} };
    const rawSessions = 'sessions' in parsed && typeof parsed.sessions === 'object' && parsed.sessions !== null ? parsed.sessions : {};

    return {
      sessions: Object.fromEntries(
        Object.entries(rawSessions as Record<string, unknown>).map(([id, value]) => {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            return [id, {}];
          }

          const raw = value as Record<string, unknown>;
          return [
            id,
            {
              title: typeof raw.title === 'string' ? raw.title : undefined,
              pinned: typeof raw.pinned === 'boolean' ? raw.pinned : undefined,
              deleted: typeof raw.deleted === 'boolean' ? raw.deleted : undefined
            }
          ];
        })
      )
    };
  } catch {
    return { sessions: {} };
  }
}

function writeConversationStore(store: ConversationStore): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CONVERSATION_ACTIONS_KEY, JSON.stringify(store));
}

function trimTitle(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return '当前 ASM 会话';
  return normalized.length > 24 ? `${normalized.slice(0, 24)}...` : normalized;
}

function buildCurrentConversationItem(
  sessionId: string,
  messages: AssistantMessage[],
  currentFilePath: string,
  store: ConversationStore
): ConversationItem {
  const userMessages = messages.filter((message) => message.role === 'user');
  const latestUserMessage = userMessages[userMessages.length - 1];
  const meta = store.sessions[sessionId] ?? {};

  return {
    id: sessionId,
    title: meta.title?.trim() || (latestUserMessage ? trimTitle(latestUserMessage.text) : '当前 ASM 会话'),
    meta: meta.pinned ? '已置顶' : latestUserMessage ? '当前会话' : '等待需求',
    filePath: currentFilePath || DEFAULT_OUTPUT_FILE_PATH,
    pinned: Boolean(meta.pinned),
    isCurrent: true,
    deleted: Boolean(meta.deleted)
  };
}

function buildConversationItems(
  sessionId: string,
  messages: AssistantMessage[],
  currentFilePath: string,
  archivedConversations: ArchivedConversation[],
  conversationOrder: string[],
  store: ConversationStore
): ConversationItem[] {
  const currentConversation = buildCurrentConversationItem(sessionId, messages, currentFilePath, store);
  const historyConversations = archivedConversations
    .filter((conversation) => conversation.id !== sessionId)
    .map((conversation) => {
      const meta = store.sessions[conversation.id] ?? {};

      return {
        id: conversation.id,
        title: meta.title?.trim() || trimTitle(conversation.title),
        meta: meta.pinned ? '已置顶' : conversation.meta ?? '历史会话',
        filePath: conversation.filePath ?? DEFAULT_OUTPUT_FILE_PATH,
        pinned: Boolean(meta.pinned),
        isCurrent: false,
        deleted: Boolean(meta.deleted)
      };
    });
  const conversations = [currentConversation, ...historyConversations].filter((conversation) => !conversation.deleted);
  const orderIndex = new Map(conversationOrder.map((id, index) => [id, index]));

  return conversations.sort((left, right) => {
    const pinnedOrder = Number(right.pinned) - Number(left.pinned);
    if (pinnedOrder !== 0) return pinnedOrder;

    const leftOrder = orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;

    return conversations.indexOf(left) - conversations.indexOf(right);
  });
}

function createModelConfigDraftState(state: ModelConfigState): ModelConfigDraftState {
  const editableConfig = getEditableModelConfig(state);
  const customModels = state.customModels.map((model) => ({ ...model }));

  return {
    provider: editableConfig.provider,
    configs: MODEL_OPTIONS.reduce(
      (configs, option) => ({
        ...configs,
        [option.value]: { ...state.configs[option.value] }
      }),
      {} as Record<ModelProvider, ProviderApiConfig>
    ),
    customModels,
    selectedCustomModelId:
      state.selectedCustomModelId && customModels.some((model) => model.id === state.selectedCustomModelId)
        ? state.selectedCustomModelId
        : customModels[0]?.id ?? null
  };
}

function providerConfigFromCustomModel(model: CustomModelConfig): ProviderApiConfig {
  return {
    apiKey: model.apiKey,
    baseUrl: model.baseUrl,
    modelId: model.modelId
  };
}

function getSelectedDraftCustomModel(state: ModelConfigDraftState): CustomModelConfig | undefined {
  return state.customModels.find((model) => model.id === state.selectedCustomModelId) ?? state.customModels[0];
}

function getCustomModelDisplayName(model: CustomModelConfig, index: number): string {
  return model.name.trim() || model.modelId.trim() || `自定义模型 ${index + 1}`;
}

function getDraftModelConfig(state: ModelConfigDraftState): ModelApiConfig {
  if (state.provider === 'custom') {
    const customModel = getSelectedDraftCustomModel(state);
    if (customModel) {
      return {
        provider: 'custom',
        customModelId: customModel.id,
        name: customModel.name,
        ...providerConfigFromCustomModel(customModel)
      };
    }
  }

  return {
    provider: state.provider,
    ...state.configs[state.provider]
  };
}

function ensureCustomModelDraft(state: ModelConfigDraftState): ModelConfigDraftState {
  const existingModel = getSelectedDraftCustomModel(state);
  if (existingModel) {
    return {
      ...state,
      selectedCustomModelId: existingModel.id,
      configs: {
        ...state.configs,
        custom: providerConfigFromCustomModel(existingModel)
      }
    };
  }

  const model = createBlankCustomModel(1);
  return {
    ...state,
    customModels: [model],
    selectedCustomModelId: model.id,
    configs: {
      ...state.configs,
      custom: providerConfigFromCustomModel(model)
    }
  };
}

export function WorkspaceSidebar({
  chipId,
  sessionId,
  messages,
  currentFilePath,
  archivedConversations,
  conversationOrder,
  modelConfigState,
  onModelConfigStateChange,
  activeNav,
  onNavigate,
  onNewSession,
  onSelectConversation,
  currentUser,
  onLogout
}: WorkspaceSidebarProps) {
  const [store, setStore] = useState<ConversationStore>(() => readConversationStore());
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renameState, setRenameState] = useState<RenameState | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [draftModelState, setDraftModelState] = useState<ModelConfigDraftState>(() => createModelConfigDraftState(modelConfigState));
  const [autoNormalize, setAutoNormalize] = useState(true);
  const [streamingOutput, setStreamingOutput] = useState(true);
  const [, forceUpdate] = useState({});

  // 订阅全局任务管理器状态变化，用于更新转圈图标
  useEffect(() => {
    const unsubscribe = sessionTaskManager.subscribe(() => {
      forceUpdate({});
    });
    return unsubscribe;
  }, []);

  const conversations = useMemo(
    () => buildConversationItems(sessionId, messages, currentFilePath, archivedConversations, conversationOrder, store),
    [archivedConversations, conversationOrder, currentFilePath, messages, sessionId, store]
  );
  const selectedConversation = conversations.find((conversation) => conversation.id === contextMenu?.conversationId) ?? null;
  const draftModelConfig = getDraftModelConfig(draftModelState);

  useEffect(() => {
    writeConversationStore(store);
  }, [store]);

  useEffect(() => {
    if (!contextMenu) return;

    const closeMenu = () => setContextMenu(null);
    window.addEventListener('click', closeMenu);
    window.addEventListener('keydown', closeMenu);
    return () => {
      window.removeEventListener('click', closeMenu);
      window.removeEventListener('keydown', closeMenu);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!statusMessage) return;

    const timeoutId = window.setTimeout(() => setStatusMessage(null), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [statusMessage]);

  const updateConversationMeta = (conversationId: string, updater: (current: ConversationSessionMeta) => ConversationSessionMeta) => {
    setStore((current) => ({
      sessions: {
        ...current.sessions,
        [conversationId]: updater(current.sessions[conversationId] ?? {})
      }
    }));
  };

  const openContextMenu = (event: MouseEvent<HTMLElement>, conversationId: string) => {
    event.preventDefault();
    setContextMenu({
      conversationId,
      x: event.clientX,
      y: event.clientY
    });
  };

  const startRename = () => {
    if (!selectedConversation) return;
    setRenameState({ conversationId: selectedConversation.id, value: selectedConversation.title });
    setContextMenu(null);
  };

  const saveRename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!renameState) return;
    const title = renameState.value.trim();
    if (!title) return;
    updateConversationMeta(renameState.conversationId, (current) => ({ ...current, title }));
    setRenameState(null);
  };

  const togglePinned = () => {
    if (!selectedConversation) return;
    updateConversationMeta(selectedConversation.id, (current) => ({ ...current, pinned: !selectedConversation.pinned }));
    setContextMenu(null);
  };

  const deleteConversation = () => {
    if (!selectedConversation) return;
    updateConversationMeta(selectedConversation.id, (current) => ({ ...current, deleted: true }));
    setContextMenu(null);
  };

  const copyFilePath = () => {
    if (!selectedConversation) return;
    const text = selectedConversation.filePath;
    void navigator.clipboard?.writeText(text);
    setStatusMessage('已复制文件路径');
    setContextMenu(null);
  };

  const revealFilePath = () => {
    setStatusMessage('网页调试版暂不支持打开系统文件夹');
    setContextMenu(null);
  };

  const openSettingsSection = (section: SettingsSection) => {
    if (section === 'model') {
      setDraftModelState(createModelConfigDraftState(modelConfigState));
    }
    setSettingsSection(section);
  };

  const openSettings = () => {
    if (settingsSection === 'model') {
      setDraftModelState(createModelConfigDraftState(modelConfigState));
    }
    setIsSettingsOpen(true);
  };

  const updateModelProvider = (provider: ModelProvider) => {
    setDraftModelState((current) => {
      const next = current.provider === provider ? current : { ...current, provider };
      return provider === 'custom' ? ensureCustomModelDraft(next) : next;
    });
  };

  const updateDraftModelConfig = (field: keyof ProviderApiConfig, value: string) => {
    setDraftModelState((current) => {
      if (current.provider === 'custom' && ['apiKey', 'baseUrl', 'modelId'].includes(field)) {
        const ensured = ensureCustomModelDraft(current);
        const selectedId = ensured.selectedCustomModelId;
        const customModels = ensured.customModels.map((model) => (model.id === selectedId ? { ...model, [field]: value } : model));
        const selectedModel = customModels.find((model) => model.id === selectedId) ?? customModels[0];

        return {
          ...ensured,
          customModels,
          configs: {
            ...ensured.configs,
            custom: selectedModel ? providerConfigFromCustomModel(selectedModel) : ensured.configs.custom
          }
        };
      }

      return {
        ...current,
        configs: {
          ...current.configs,
          [current.provider]: {
            ...current.configs[current.provider],
            [field]: value
          }
        }
      };
    });
  };

  const updateDraftCustomModel = (field: keyof CustomModelConfig, value: string) => {
    setDraftModelState((current) => {
      const ensured = ensureCustomModelDraft(current);
      const selectedId = ensured.selectedCustomModelId;
      const customModels = ensured.customModels.map((model) => (model.id === selectedId ? { ...model, [field]: value } : model));
      const selectedModel = customModels.find((model) => model.id === selectedId) ?? customModels[0];

      return {
        ...ensured,
        customModels,
        configs: {
          ...ensured.configs,
          custom: selectedModel ? providerConfigFromCustomModel(selectedModel) : ensured.configs.custom
        }
      };
    });
  };

  const addCustomModel = () => {
    setDraftModelState((current) => {
      const model = createBlankCustomModel(current.customModels.length + 1);
      return {
        ...current,
        provider: 'custom',
        customModels: [...current.customModels, model],
        selectedCustomModelId: model.id,
        configs: {
          ...current.configs,
          custom: providerConfigFromCustomModel(model)
        }
      };
    });
  };

  const selectCustomModel = (modelId: string) => {
    setDraftModelState((current) => {
      const selectedModel = current.customModels.find((model) => model.id === modelId);
      if (!selectedModel) return current;

      return {
        ...current,
        provider: 'custom',
        selectedCustomModelId: selectedModel.id,
        configs: {
          ...current.configs,
          custom: providerConfigFromCustomModel(selectedModel)
        }
      };
    });
  };

  const deleteSelectedCustomModel = () => {
    setDraftModelState((current) => {
      const selectedId = current.selectedCustomModelId;
      if (!selectedId) return current;

      const remainingModels = current.customModels.filter((model) => model.id !== selectedId);
      const customModels = remainingModels.length > 0 ? remainingModels : [createBlankCustomModel(1)];
      const selectedModel = customModels[0];

      return {
        ...current,
        provider: 'custom',
        customModels,
        selectedCustomModelId: selectedModel.id,
        configs: {
          ...current.configs,
          custom: providerConfigFromCustomModel(selectedModel)
        }
      };
    });
  };

  const persistModelConfig = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const customModels = draftModelState.customModels.map((model, index) => ({
      ...model,
      name: getCustomModelDisplayName(model, index)
    }));
    const selectedCustomModel =
      customModels.find((model) => model.id === draftModelState.selectedCustomModelId) ?? customModels[0] ?? null;
    const selectedCustomModelId = selectedCustomModel?.id ?? null;

    onModelConfigStateChange((current) => ({
      selectedProvider: draftModelConfig.provider,
      configs: {
        ...current.configs,
        ...draftModelState.configs,
        ...(selectedCustomModel ? { custom: providerConfigFromCustomModel(selectedCustomModel) } : {})
      },
      customModels,
      selectedCustomModelId
    }));
    setIsSettingsOpen(false);
  };

  const settingsDialog = isSettingsOpen ? (
    <div className="settings-backdrop">
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-label="设置">
        <aside className="settings-nav" aria-label="设置分类">
          <div className="settings-title">设置</div>
          <button
            className={`settings-nav-item${settingsSection === 'general' ? ' active' : ''}`}
            type="button"
            onClick={() => openSettingsSection('general')}
          >
            <span className="settings-nav-icon gear" aria-hidden="true" />
            <span>通用设置</span>
          </button>
          <button
            className={`settings-nav-item${settingsSection === 'model' ? ' active' : ''}`}
            type="button"
            onClick={() => openSettingsSection('model')}
          >
            <span className="settings-nav-icon model" aria-hidden="true" />
            <span>模型配置</span>
          </button>
          <button
            className={`settings-nav-item${settingsSection === 'about' ? ' active' : ''}`}
            type="button"
            onClick={() => openSettingsSection('about')}
          >
            <span className="settings-nav-icon info" aria-hidden="true" />
            <span>关于</span>
          </button>
        </aside>

        <div className="settings-content">
          <button className="settings-close" type="button" aria-label="关闭设置" onClick={() => setIsSettingsOpen(false)}>
            ×
          </button>

          {settingsSection === 'general' ? (
            <div className="settings-page">
              <header className="settings-page-header">
                <span className="settings-page-kicker">General</span>
                <h2>通用设置</h2>
                <p className="settings-page-description">调整 ASM 生成体验的默认行为，保持会话输出稳定、可控。</p>
              </header>
              <div className="settings-page-body">
                <div className="settings-card settings-option-card">
                  <label className="settings-toggle-row">
                    <span>
                      <strong>自动规范化 ASM</strong>
                      <small>生成候选代码后自动接入内置 HK8S8100X 规范校验。</small>
                    </span>
                    <input type="checkbox" checked={autoNormalize} onChange={(event) => setAutoNormalize(event.target.checked)} />
                  </label>
                  <label className="settings-toggle-row">
                    <span>
                      <strong>启用流式输出</strong>
                      <small>模型回复和本地生成结果按过程逐步展示。</small>
                    </span>
                    <input type="checkbox" checked={streamingOutput} onChange={(event) => setStreamingOutput(event.target.checked)} />
                  </label>
                </div>

                <section className="settings-card settings-account-card" aria-labelledby="settings-account-title">
                  <div className="settings-account-head">
                    <span className="settings-account-avatar" aria-hidden="true">
                      {currentUser.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <h3 id="settings-account-title">账号</h3>
                      <p>当前登录身份用于访问本地 ASM 工程、知识库和历史会话。</p>
                    </div>
                  </div>
                  <dl className="settings-account-details">
                    <div>
                      <dt>姓名</dt>
                      <dd>{currentUser.name}</dd>
                    </div>
                    <div>
                      <dt>岗位</dt>
                      <dd>{currentUser.role}</dd>
                    </div>
                  </dl>
                  <button className="settings-logout-button" type="button" onClick={onLogout}>
                    退出登录
                  </button>
                </section>
              </div>
            </div>
          ) : settingsSection === 'model' ? (
            <div className="settings-page">
              <header className="settings-page-header">
                <span className="settings-page-kicker">Model</span>
                <h2>模型 API 配置</h2>
                <p className="settings-page-description">配置第三方 OpenAI 兼容模型通道，用于候选草稿和普通对话。</p>
              </header>
              <div className="settings-page-body">
                <form className="model-config-form settings-model-form" onSubmit={persistModelConfig}>
                  <label htmlFor="model-provider">服务商</label>
                  <select
                    id="model-provider"
                    value={draftModelConfig.provider}
                    onChange={(event) => updateModelProvider(event.target.value as ModelProvider)}
                  >
                    {MODEL_OPTIONS.filter((option) => option.value !== 'local').map((option) => (
                      <option value={option.value} key={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="form-hint">{buildProviderConfigHint(draftModelConfig)}</p>

                  {draftModelConfig.provider === 'custom' ? (
                    <>
                      <div className="custom-model-manager" aria-label="自定义模型记录">
                        <div className="custom-model-manager-head">
                          <strong>自定义模型记录</strong>
                          <div>
                            <button className="custom-model-add-button" type="button" onClick={addCustomModel}>
                              新增自定义模型
                            </button>
                            <button
                              className="custom-model-delete-button"
                              type="button"
                              onClick={deleteSelectedCustomModel}
                              disabled={draftModelState.customModels.length <= 1}
                            >
                              删除当前
                            </button>
                          </div>
                        </div>
                        <div className="custom-model-list" role="list" aria-label="已保存的自定义模型">
                          {draftModelState.customModels.map((model, index) => {
                            const displayName = getCustomModelDisplayName(model, index);
                            const isSelected = model.id === draftModelState.selectedCustomModelId;

                            return (
                              <button
                                className={`custom-model-record${isSelected ? ' selected' : ''}`}
                                type="button"
                                aria-current={isSelected ? 'true' : undefined}
                                aria-pressed={isSelected}
                                aria-label={displayName}
                                key={model.id}
                                onClick={() => selectCustomModel(model.id)}
                              >
                                <strong>{displayName}</strong>
                                <span>{model.modelId.trim() || '未填写 Model ID'}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <label htmlFor="custom-model-name">模型名称</label>
                      <input
                        id="custom-model-name"
                        value={draftModelConfig.name ?? ''}
                        onChange={(event) => updateDraftCustomModel('name', event.target.value)}
                        placeholder="例如：公司中转 GPT、备用 Qwen"
                      />
                      <p className="form-hint">名称只用于本地识别不同自定义模型，不会发送给模型服务商。</p>
                    </>
                  ) : null}

                  <label htmlFor="model-api-key">API Key</label>
                  <input
                    id="model-api-key"
                    type="password"
                    value={draftModelConfig.apiKey}
                    onChange={(event) => updateDraftModelConfig('apiKey', event.target.value)}
                    placeholder="由用户自行在第三方模型平台创建"
                  />

                  <label htmlFor="model-base-url">Base URL</label>
                  <input
                    id="model-base-url"
                    value={draftModelConfig.baseUrl}
                    onChange={(event) => updateDraftModelConfig('baseUrl', event.target.value)}
                    placeholder="例如：https://api.example.com/v1"
                  />
                  <p className="form-hint">
                    请填写 API 根地址，不要填写官网、控制台、登录页或文档页；实际请求地址：
                    {buildChatEndpointPreview(draftModelConfig.baseUrl)}
                  </p>

                  <label htmlFor="model-id">Model ID</label>
                  <input
                    id="model-id"
                    value={draftModelConfig.modelId}
                    onChange={(event) => updateDraftModelConfig('modelId', event.target.value)}
                    placeholder="例如：deepseek-chat、glm-4、gpt-4o"
                  />

                  <div className="dialog-actions">
                    <button className="secondary-dialog-action" type="button" onClick={() => openSettingsSection('general')}>
                      取消
                    </button>
                    <button className="primary-dialog-action" type="submit">
                      保存配置
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : (
            <div className="settings-page about-page">
              <header className="settings-page-header">
                <span className="settings-page-kicker">About</span>
                <h2>关于</h2>
                <p className="settings-page-description">查看当前工具版本和目标芯片平台信息。</p>
              </header>
              <div className="settings-page-body">
                <div className="about-brand">
                  <img src="hsxp-logo.jpg" alt="" />
                  <div>
                    <strong>航顺 ASM Agent</strong>
                    <span>{chipId} 工程助手</span>
                  </div>
                </div>
                <div className="settings-card about-card">
                  <div>
                    <span>当前版本</span>
                    <strong>v0.1.0-web</strong>
                  </div>
                  <div>
                    <span>目标芯片</span>
                    <strong>{chipId}</strong>
                  </div>
                  <a href="https://www.hsxp-hk.com/" target="_blank" rel="noreferrer">
                    进入官网
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  ) : null;

  return (
    <>
      <aside className="panel workspace-sidebar" aria-label="ASM Agent 导航">
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <span className="brand-mark" aria-hidden="true">
              <img src="hsxp-logo.jpg" alt="" />
            </span>
            <div>
              <strong>航顺 ASM Agent</strong>
              <span>HK8S8100X 工程助手</span>
              <span>规范库已锁定</span>
            </div>
          </div>
        </div>

        <button className="sidebar-new-button" type="button" onClick={onNewSession}>
          <span className="new-chat-icon" aria-hidden="true" />
          <span>新建对话</span>
          <span className="sidebar-new-hint" aria-hidden="true">⌘K</span>
        </button>

        <nav className="primary-nav" aria-label="主导航">
          {PRIMARY_NAV.map((item) => (
            <button
              className={`primary-nav-item${activeNav === item.id ? ' active' : ''}`}
              type="button"
              key={item.id}
              aria-current={activeNav === item.id ? 'page' : undefined}
              onClick={() => onNavigate(item.id)}
            >
              <span className="primary-nav-icon" aria-hidden="true">
                <img src={item.icon} alt="" />
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <nav className="conversation-list" aria-label="历史对话">
          <div className="conversation-list-head">
            <span className="sidebar-section-title">最近对话</span>
            <span className="conversation-search-icon" aria-hidden="true">
              <img src="icons/20_search.svg" alt="" />
            </span>
          </div>
          {conversations.length === 0 ? <div className="conversation-empty">暂无历史会话</div> : null}
          {conversations.map((conversation) => (
            <button
              className={`conversation-item${conversation.isCurrent ? ' active' : ''}${conversation.pinned ? ' pinned' : ''}`}
              key={conversation.id}
              type="button"
              aria-current={conversation.isCurrent ? 'true' : undefined}
              onClick={() => onSelectConversation(conversation.id)}
              onContextMenu={(event) => openContextMenu(event, conversation.id)}
            >
              <span className="conversation-title">{conversation.title}</span>
              <span className="conversation-meta">{conversation.meta}</span>
              {sessionTaskManager.hasActiveTask(conversation.id) ? (
                <span className="conversation-spinner" aria-label="任务执行中" />
              ) : null}
            </button>
          ))}
        </nav>

        {contextMenu && selectedConversation ? (
          <div
            className="conversation-context-menu"
            role="menu"
            aria-label="会话操作"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" role="menuitem" onClick={startRename}>
              重命名
            </button>
            <button type="button" role="menuitem" onClick={togglePinned}>
              {selectedConversation.pinned ? '取消置顶' : '置顶'}
            </button>
            <button type="button" role="menuitem" onClick={deleteConversation}>
              删除
            </button>
            <button type="button" role="menuitem" onClick={revealFilePath}>
              打开文件所在路径
            </button>
            <button type="button" role="menuitem" onClick={copyFilePath}>
              复制文件路径
            </button>
          </div>
        ) : null}

        {renameState ? (
          <form className="conversation-rename-form" onSubmit={saveRename}>
            <label htmlFor="conversation-name">会话名称</label>
            <input
              id="conversation-name"
              value={renameState.value}
              onChange={(event) => setRenameState((current) => (current ? { ...current, value: event.target.value } : current))}
              autoFocus
            />
            <div className="rename-actions">
              <button type="button" onClick={() => setRenameState(null)}>
                取消
              </button>
              <button type="submit">保存名称</button>
            </div>
          </form>
        ) : null}

        {statusMessage ? <div className="sidebar-toast">{statusMessage}</div> : null}

        <div className="sidebar-footer">
          <button className="sidebar-settings-button" type="button" onClick={openSettings}>
            <span className="settings-icon" aria-hidden="true" />
            <span>设置</span>
            <span className="settings-chevron" aria-hidden="true" />
          </button>
          <section className="sidebar-user-card" aria-label="当前用户信息">
            <span className="sidebar-user-avatar" aria-hidden="true">
              {currentUser.name.slice(0, 1).toUpperCase()}
            </span>
            <div className="sidebar-user-meta">
              <div>
                <span>姓名</span>
                <strong>{currentUser.name}</strong>
              </div>
              <div>
                <span>岗位</span>
                <strong>{currentUser.role}</strong>
              </div>
            </div>
          </section>
        </div>
      </aside>
      {settingsDialog && typeof document !== 'undefined' ? createPortal(settingsDialog, document.body) : null}
    </>
  );
}
