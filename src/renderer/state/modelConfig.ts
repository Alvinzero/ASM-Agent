export type ModelProvider = 'local' | 'deepseek' | 'glm' | 'gpt' | 'qwen' | 'custom';

export interface ModelApiConfig {
  provider: ModelProvider;
  apiKey: string;
  baseUrl: string;
  modelId: string;
  customModelId?: string;
  name?: string;
}

export type ProviderApiConfig = Pick<ModelApiConfig, 'apiKey' | 'baseUrl' | 'modelId'>;

export interface CustomModelConfig {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  modelId: string;
}

export interface ModelConfigState {
  selectedProvider: ModelProvider;
  configs: Record<ModelProvider, ProviderApiConfig>;
  customModels: CustomModelConfig[];
  selectedCustomModelId: string | null;
}

export const MODEL_CONFIG_KEY = 'asm-agent-model-config';

export const MODEL_OPTIONS: Array<{ value: ModelProvider; label: string }> = [
  { value: 'local', label: '本地规则引擎' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'glm', label: 'GLM' },
  { value: 'gpt', label: 'GPT' },
  { value: 'qwen', label: 'Qwen' },
  { value: 'custom', label: '自定义 OpenAI 兼容模型' }
];

export const PROVIDER_DEFAULTS: Record<ModelProvider, Pick<ModelApiConfig, 'baseUrl' | 'modelId'>> = {
  local: { baseUrl: '', modelId: 'local-rules' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', modelId: 'deepseek-chat' },
  glm: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', modelId: 'glm-4' },
  gpt: { baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-4o' },
  qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelId: 'qwen-plus' },
  custom: { baseUrl: '', modelId: '' }
};

export function isModelProvider(value: unknown): value is ModelProvider {
  return typeof value === 'string' && MODEL_OPTIONS.some((option) => option.value === value);
}

export function createDefaultProviderConfig(provider: ModelProvider): ProviderApiConfig {
  return {
    apiKey: '',
    ...PROVIDER_DEFAULTS[provider]
  };
}

export function createDefaultConfigState(): ModelConfigState {
  return {
    selectedProvider: 'local',
    customModels: [],
    selectedCustomModelId: null,
    configs: MODEL_OPTIONS.reduce(
      (configs, option) => ({
        ...configs,
        [option.value]: createDefaultProviderConfig(option.value)
      }),
      {} as Record<ModelProvider, ProviderApiConfig>
    )
  };
}

export function createBlankCustomModel(index: number): CustomModelConfig {
  return {
    id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name: `自定义模型 ${index}`,
    apiKey: '',
    baseUrl: '',
    modelId: ''
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeProviderConfig(provider: ModelProvider, value: unknown): ProviderApiConfig {
  const raw = isRecord(value) ? value : {};

  return {
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : PROVIDER_DEFAULTS[provider].baseUrl,
    modelId: typeof raw.modelId === 'string' ? raw.modelId : PROVIDER_DEFAULTS[provider].modelId
  };
}

function normalizeCustomModelConfig(value: unknown, fallbackIndex: number): CustomModelConfig {
  const raw = isRecord(value) ? value : {};
  const modelId = typeof raw.modelId === 'string' ? raw.modelId : '';
  const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl : '';
  const name = typeof raw.name === 'string' && raw.name.trim().length > 0 ? raw.name.trim() : modelId || `自定义模型 ${fallbackIndex}`;

  return {
    id: typeof raw.id === 'string' && raw.id.trim().length > 0 ? raw.id.trim() : `custom-${fallbackIndex}`,
    name,
    apiKey: typeof raw.apiKey === 'string' ? raw.apiKey : '',
    baseUrl,
    modelId
  };
}

function toProviderConfig(config: CustomModelConfig): ProviderApiConfig {
  return {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    modelId: config.modelId
  };
}

export function getSelectedCustomModel(state: ModelConfigState): CustomModelConfig | undefined {
  return state.customModels.find((model) => model.id === state.selectedCustomModelId) ?? state.customModels[0];
}

export function getSelectedModelConfig(state: ModelConfigState): ModelApiConfig {
  if (state.selectedProvider === 'custom') {
    const customModel = getSelectedCustomModel(state);
    if (customModel) {
      return {
        provider: 'custom',
        customModelId: customModel.id,
        name: customModel.name,
        ...toProviderConfig(customModel)
      };
    }
  }

  return {
    provider: state.selectedProvider,
    ...(state.configs[state.selectedProvider] ?? createDefaultProviderConfig(state.selectedProvider))
  };
}

export function getEditableModelConfig(state: ModelConfigState): ModelApiConfig {
  const provider = state.selectedProvider === 'local' ? 'deepseek' : state.selectedProvider;

  if (provider === 'custom') {
    const customModel = getSelectedCustomModel(state);
    if (customModel) {
      return {
        provider,
        customModelId: customModel.id,
        name: customModel.name,
        ...toProviderConfig(customModel)
      };
    }
  }

  return {
    provider,
    ...(state.configs[provider] ?? createDefaultProviderConfig(provider))
  };
}

export function readSavedModelConfigState(): ModelConfigState {
  if (typeof window === 'undefined') return createDefaultConfigState();

  try {
    const raw = window.localStorage.getItem(MODEL_CONFIG_KEY);
    if (!raw) return createDefaultConfigState();
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return createDefaultConfigState();
    const selectedProvider = isModelProvider(parsed.selectedProvider)
      ? parsed.selectedProvider
      : isModelProvider(parsed.provider)
        ? parsed.provider
        : 'local';
    const state = createDefaultConfigState();
    state.selectedProvider = selectedProvider;

    const savedConfigs = isRecord(parsed.configs) ? parsed.configs : undefined;
    for (const option of MODEL_OPTIONS) {
      const savedConfig = savedConfigs?.[option.value];
      if (savedConfig !== undefined) {
        state.configs[option.value] = normalizeProviderConfig(option.value, savedConfig);
      }
    }

    if (isModelProvider(parsed.provider)) {
      state.configs[parsed.provider] = normalizeProviderConfig(parsed.provider, parsed);
    }

    const savedCustomModels = Array.isArray(parsed.customModels) ? parsed.customModels : [];
    state.customModels = savedCustomModels.map((customModel, index) => normalizeCustomModelConfig(customModel, index + 1));

    if (state.customModels.length === 0) {
      const legacyCustomConfig = savedConfigs?.custom ?? (parsed.provider === 'custom' ? parsed : undefined);
      if (legacyCustomConfig !== undefined) {
        const normalizedLegacyConfig = normalizeProviderConfig('custom', legacyCustomConfig);
        const hasLegacyValue =
          normalizedLegacyConfig.apiKey.trim().length > 0 ||
          normalizedLegacyConfig.baseUrl.trim().length > 0 ||
          normalizedLegacyConfig.modelId.trim().length > 0;

        if (hasLegacyValue) {
          state.customModels = [
            {
              id: 'custom-1',
              name: normalizedLegacyConfig.modelId.trim() || '自定义模型 1',
              ...normalizedLegacyConfig
            }
          ];
        }
      }
    }

    const selectedCustomModelId =
      typeof parsed.selectedCustomModelId === 'string' &&
      state.customModels.some((model) => model.id === parsed.selectedCustomModelId)
        ? parsed.selectedCustomModelId
        : state.customModels[0]?.id ?? null;
    state.selectedCustomModelId = selectedCustomModelId;

    const selectedCustomModel = getSelectedCustomModel(state);
    if (selectedCustomModel) {
      state.configs.custom = toProviderConfig(selectedCustomModel);
    }

    return state;
  } catch {
    return createDefaultConfigState();
  }
}

export function saveModelConfigState(state: ModelConfigState): void {
  const selectedConfig = getSelectedModelConfig(state);
  window.localStorage.setItem(
    MODEL_CONFIG_KEY,
    JSON.stringify({
      ...selectedConfig,
      selectedProvider: state.selectedProvider,
      configs: state.configs,
      customModels: state.customModels,
      selectedCustomModelId: state.selectedCustomModelId
    })
  );
}

export function getModelLabel(provider: ModelProvider): string {
  return MODEL_OPTIONS.find((option) => option.value === provider)?.label ?? provider;
}

export function isCompleteModelConfig(config: ModelApiConfig): boolean {
  return (
    config.provider !== 'local' &&
    config.apiKey.trim().length > 0 &&
    config.baseUrl.trim().length > 0 &&
    config.modelId.trim().length > 0
  );
}

export function buildChatEndpointPreview(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/g, '');
  if (!normalized) return '填写 Base URL 后显示实际请求地址';
  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

export function buildProviderConfigHint(config: ModelApiConfig): string {
  if (config.provider === 'custom') {
    return '自定义服务需要填写 OpenAI 兼容 API 根地址，例如 https://api.example.com/v1。';
  }

  const defaults = PROVIDER_DEFAULTS[config.provider];
  return `${getModelLabel(config.provider)} 默认 Base URL：${defaults.baseUrl}；Model ID 示例：${defaults.modelId}。`;
}
