import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';

import type { UpdateSnapshot } from '../../src/shared/updater/UpdateSnapshot';
import { createRendererFallbackResponse } from '../../src/main/protocol/RendererFallbackProtocolCore';

function createProtocolRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

function createBaseDependencies() {
  return {
    completeChat: vi.fn(),
    streamChat: vi.fn(),
    saveSessionAsmFile: vi.fn(),
    showItemInFolder: vi.fn(),
    documentsDir: 'C:\\Users\\demo\\Documents',
    getUpdateState: vi.fn<() => UpdateSnapshot>(() => ({
      status: 'idle',
      version: '0.0.5'
    })),
    checkForUpdates: vi.fn<() => Promise<UpdateSnapshot>>(async () => ({
      status: 'checking',
      version: '0.0.5'
    })),
    quitAndInstallUpdate: vi.fn()
  };
}

describe('renderer fallback protocol', () => {
  it('streams desktop fallback model responses through an OpenAI-compatible SSE response', async () => {
    const dependencies = createBaseDependencies();
    dependencies.streamChat.mockImplementation(async (_request, onEvent) => {
      onEvent({ kind: 'assistant_reasoning_delta', text: '先分析。' });
      onEvent({ kind: 'assistant_text_delta', text: '最终回答' });
      onEvent({ kind: 'completed', stopReason: 'stop' });
      return '最终回答';
    });

    const response = await createRendererFallbackResponse(
      createProtocolRequest('asm-agent://local/api/complete-chat-stream', {
        provider: 'custom',
        label: 'Custom model',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.example.com/v1',
        modelId: 'custom-chat',
        prompt: 'hello',
        systemPrompt: 'answer briefly'
      }),
      dependencies
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    const body = await response.text();
    expect(body).toContain('"reasoning_content":"先分析。"');
    expect(body).toContain('"content":"最终回答"');
    expect(body).toContain('[DONE]');
  });

  it('saves desktop fallback session files through the protocol handler', async () => {
    const dependencies = createBaseDependencies();
    const saveSessionAsmFile = vi.fn(() => ({
      path: 'main.asm',
      absolutePath: 'C:\\Users\\demo\\Documents\\ASM Agent\\sessions\\session-1\\main.asm',
      sessionDir: 'C:\\Users\\demo\\Documents\\ASM Agent\\sessions\\session-1'
    }));
    dependencies.saveSessionAsmFile = saveSessionAsmFile;

    const response = await createRendererFallbackResponse(
      createProtocolRequest('asm-agent://local/api/session-file/save', {
        sessionId: 'session-1',
        file: {
          path: 'main.asm',
          content: 'CLRWDT\n'
        }
      }),
      dependencies
    );

    expect(response.status).toBe(200);
    expect(saveSessionAsmFile).toHaveBeenCalledWith(path.join('C:\\Users\\demo\\Documents', 'ASM Agent', 'sessions'), 'session-1', {
      path: 'main.asm',
      content: 'CLRWDT\n'
    });
    await expect(response.json()).resolves.toMatchObject({
      path: 'main.asm'
    });
  });

  it('reads desktop fallback updater state through the protocol handler', async () => {
    const dependencies = createBaseDependencies();
    const response = await createRendererFallbackResponse(
      createProtocolRequest('asm-agent://local/api/updater/state', {}),
      dependencies
    );

    await expect(response.json()).resolves.toMatchObject({
      status: 'idle',
      version: '0.0.5'
    });
  });

  it('starts desktop fallback update checks through the protocol handler', async () => {
    const dependencies = createBaseDependencies();
    const checkForUpdates = vi.fn<() => Promise<UpdateSnapshot>>(async () => ({
      status: 'checking',
      version: '0.0.5'
    }));
    dependencies.checkForUpdates = checkForUpdates;

    const response = await createRendererFallbackResponse(
      createProtocolRequest('asm-agent://local/api/updater/check', {}),
      dependencies
    );

    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      status: 'checking',
      version: '0.0.5'
    });
  });
});
