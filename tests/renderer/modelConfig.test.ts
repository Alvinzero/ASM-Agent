import { beforeEach, describe, expect, it } from 'vitest';

import {
  getSelectedModelConfig,
  MODEL_CONFIG_KEY,
  readSavedModelConfigState,
  saveModelConfigState
} from '../../src/renderer/state/modelConfig';

describe('model configuration state', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('migrates a legacy single custom provider config into the custom model records', () => {
    window.localStorage.setItem(
      MODEL_CONFIG_KEY,
      JSON.stringify({
        provider: 'custom',
        apiKey: 'sk-legacy-key',
        baseUrl: 'https://legacy.example.com/v1',
        modelId: 'legacy-chat'
      })
    );

    const state = readSavedModelConfigState();

    expect(state.selectedProvider).toBe('custom');
    expect(state.customModels).toHaveLength(1);
    expect(state.customModels[0]).toMatchObject({
      apiKey: 'sk-legacy-key',
      baseUrl: 'https://legacy.example.com/v1',
      modelId: 'legacy-chat'
    });
    expect(getSelectedModelConfig(state)).toMatchObject({
      provider: 'custom',
      apiKey: 'sk-legacy-key',
      baseUrl: 'https://legacy.example.com/v1',
      modelId: 'legacy-chat'
    });
  });

  it('persists multiple custom model records and restores the selected record', () => {
    saveModelConfigState({
      selectedProvider: 'custom',
      selectedCustomModelId: 'custom-backup',
      configs: {
        local: { apiKey: '', baseUrl: '', modelId: 'local-rules' },
        deepseek: { apiKey: '', baseUrl: 'https://api.deepseek.com/v1', modelId: 'deepseek-chat' },
        glm: { apiKey: '', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', modelId: 'glm-4' },
        gpt: { apiKey: '', baseUrl: 'https://api.openai.com/v1', modelId: 'gpt-4o' },
        qwen: { apiKey: '', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelId: 'qwen-plus' },
        custom: { apiKey: 'sk-backup', baseUrl: 'https://backup.example.com/v1', modelId: 'backup-chat' }
      },
      customModels: [
        {
          id: 'custom-primary',
          name: '公司中转 GPT',
          apiKey: 'sk-primary',
          baseUrl: 'https://primary.example.com/v1',
          modelId: 'primary-chat'
        },
        {
          id: 'custom-backup',
          name: '备用 Qwen',
          apiKey: 'sk-backup',
          baseUrl: 'https://backup.example.com/v1',
          modelId: 'backup-chat'
        }
      ]
    });

    const restored = readSavedModelConfigState();

    expect(restored.customModels.map((model) => model.name)).toEqual(['公司中转 GPT', '备用 Qwen']);
    expect(restored.selectedCustomModelId).toBe('custom-backup');
    expect(getSelectedModelConfig(restored)).toMatchObject({
      provider: 'custom',
      apiKey: 'sk-backup',
      baseUrl: 'https://backup.example.com/v1',
      modelId: 'backup-chat'
    });
  });
});
