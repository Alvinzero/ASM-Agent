import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompleteChatRequest } from '../../src/shared/agent/ModelAdapter';
import { streamChatViaLocalProxy } from '../../src/renderer/state/BrowserModelProxy';

function buildChatRequest(): CompleteChatRequest {
  return {
    provider: 'custom',
    label: 'Custom model',
    apiKey: 'sk-test-key',
    baseUrl: 'https://api.example.com/v1',
    modelId: 'custom-chat',
    prompt: 'Hello',
    systemPrompt: 'Answer briefly.'
  };
}

describe('browser fallback model proxy', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, 'asmAgent', {
      configurable: true,
      value: undefined
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('routes completeChat through the local Vite API proxy', async () => {
    const request = buildChatRequest();
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ content: 'proxied answer' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getAsmAgent } = await import('../../src/renderer/state/useAgentSession');
    const agent = getAsmAgent();

    await expect(agent?.completeChat?.(request)).resolves.toBe('proxied answer');
    expect(fetchMock).toHaveBeenCalledWith('/api/complete-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request)
    });
  });

  it('reads OpenAI-compatible SSE chunks from the local stream proxy', async () => {
    const request = buildChatRequest();
    const firstEvent = 'data: {"choices":[{"delta":{"content":"你"}}]}\n\n';
    const secondEvent = 'data: {"choices":[{"delta":{"content":"好"}}]}\n\n';
    const doneEvent = 'data: [DONE]\n\n';
    const encoded = new TextEncoder().encode(firstEvent + secondEvent + doneEvent);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, 12));
        controller.enqueue(encoded.slice(12, 49));
        controller.enqueue(encoded.slice(49));
        controller.close();
      }
    });
    const fetchMock = vi.fn(async () => {
      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream'
        }
      });
    });
    const onChunk = vi.fn();

    await expect(streamChatViaLocalProxy(request, onChunk, fetchMock)).resolves.toBe('你好');
    expect(onChunk).toHaveBeenNthCalledWith(1, '你');
    expect(onChunk).toHaveBeenNthCalledWith(2, '好');
    expect(fetchMock).toHaveBeenCalledWith('/api/complete-chat-stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request)
    });
  });

  it('keeps conversation memory messages in stream proxy requests', async () => {
    const request: CompleteChatRequest = {
      ...buildChatRequest(),
      prompt: 'What is my name?',
      messages: [
        { role: 'user', content: 'My name is Zhang San.' },
        { role: 'assistant', content: 'I will remember it.' },
        { role: 'user', content: 'What is my name?' }
      ]
    };
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      capturedInit = init;
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }), {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream'
        }
      });
    });

    await expect(streamChatViaLocalProxy(request, vi.fn(), fetchMock)).resolves.toBe('');
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      prompt: 'What is my name?',
      messages: [
        { role: 'user', content: 'My name is Zhang San.' },
        { role: 'assistant', content: 'I will remember it.' },
        { role: 'user', content: 'What is my name?' }
      ]
    });
  });

  it('passes abort signals into the local stream proxy fetch request', async () => {
    const request = buildChatRequest();
    const abortController = new AbortController();
    let capturedInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      capturedInit = init;
      return new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }), {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream'
        }
      });
    });

    await streamChatViaLocalProxy(request, vi.fn(), fetchMock, abortController.signal);

    expect(capturedInit?.signal).toBe(abortController.signal);
  });
});
