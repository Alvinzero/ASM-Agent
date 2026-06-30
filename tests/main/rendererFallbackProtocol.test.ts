import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';

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

describe('renderer fallback protocol', () => {
  it('streams desktop fallback model responses through an OpenAI-compatible SSE response', async () => {
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
      {
        completeChat: vi.fn(),
        streamChat: vi.fn(async (_request, onEvent) => {
          onEvent({ kind: 'assistant_reasoning_delta', text: '先分析。' });
          onEvent({ kind: 'assistant_text_delta', text: '最终回答' });
          onEvent({ kind: 'completed', stopReason: 'stop' });
          return '最终回答';
        }),
        saveSessionAsmFile: vi.fn(),
        showItemInFolder: vi.fn(),
        documentsDir: 'C:\\Users\\demo\\Documents'
      }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    const body = await response.text();
    expect(body).toContain('"reasoning_content":"先分析。"');
    expect(body).toContain('"content":"最终回答"');
    expect(body).toContain('[DONE]');
  });

  it('saves desktop fallback session files through the protocol handler', async () => {
    const saveSessionAsmFile = vi.fn(() => ({
      path: 'main.asm',
      absolutePath: 'C:\\Users\\demo\\Documents\\ASM Agent\\sessions\\session-1\\main.asm',
      sessionDir: 'C:\\Users\\demo\\Documents\\ASM Agent\\sessions\\session-1'
    }));

    const response = await createRendererFallbackResponse(
      createProtocolRequest('asm-agent://local/api/session-file/save', {
        sessionId: 'session-1',
        file: {
          path: 'main.asm',
          content: 'CLRWDT\n'
        }
      }),
      {
        completeChat: vi.fn(),
        streamChat: vi.fn(),
        saveSessionAsmFile,
        showItemInFolder: vi.fn(),
        documentsDir: 'C:\\Users\\demo\\Documents'
      }
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
});
