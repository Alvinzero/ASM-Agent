import {
  drainSseBuffer,
  readOpenAiCompatibleStreamEvents,
  type CompleteChatRequest,
  type ModelStreamEventHandler
} from '../../shared/agent/ModelAdapter';

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const COMPLETE_CHAT_PROXY_ENDPOINT = '/api/complete-chat';
const COMPLETE_CHAT_STREAM_PROXY_ENDPOINT = '/api/complete-chat-stream';

export async function completeChatViaLocalProxy(
  request: CompleteChatRequest,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(COMPLETE_CHAT_PROXY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request),
      signal
    });
  } catch (caught) {
    if (caught instanceof TypeError) {
      throw new Error('网页版本地模型代理不可用，请重启 npm run dev 后再试。');
    }

    throw caught;
  }

  const responseText = await response.text();
  const payload = parseProxyJson(responseText, response.headers.get('Content-Type') ?? '');
  if (!response.ok) {
    throw new Error(readProxyError(payload, response.status));
  }

  const content = readProxyContent(payload);
  if (!content) {
    throw new Error('网页版本地模型代理返回为空或格式不兼容。');
  }

  return content;
}

export async function streamChatViaLocalProxy(
  request: CompleteChatRequest,
  onEvent: ModelStreamEventHandler,
  fetchImpl: FetchLike = fetch,
  signal?: AbortSignal
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl(COMPLETE_CHAT_STREAM_PROXY_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(request),
      signal
    });
  } catch (caught) {
    if (caught instanceof TypeError) {
      throw new Error('网页版本地流式模型代理不可用，请重启 npm run dev 后再试。');
    }

    throw caught;
  }

  if (!response.ok) {
    throw new Error(readProxyError(parseProxyJson(await response.text(), response.headers.get('Content-Type') ?? ''), response.status));
  }

  if (!response.body) {
    throw new Error('网页版本地流式模型代理没有返回可读取的数据流。');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let streamDone = false;

  while (!streamDone) {
    const readResult = await reader.read();
    if (readResult.done) break;

    buffer += decoder.decode(readResult.value, { stream: true });
    const parsed = drainSseBuffer(buffer);
    buffer = parsed.rest;

    for (const block of parsed.blocks) {
      const events = readOpenAiCompatibleStreamEvents(block);
      for (const event of events) {
        if (event.kind === 'error') {
          throw new Error(`网页版本地流式模型代理请求失败：${event.message}`);
        }
        if (event.kind === 'assistant_text_delta') {
          fullText += event.text;
        }
        onEvent(event);
        if (event.kind === 'completed') {
          streamDone = true;
          break;
        }
      }
      if (streamDone) break;
    }
  }

  buffer += decoder.decode();
  if (buffer.trim() && !streamDone) {
    const events = readOpenAiCompatibleStreamEvents(buffer);
    for (const event of events) {
      if (event.kind === 'error') {
        throw new Error(`网页版本地流式模型代理请求失败：${event.message}`);
      }
      if (event.kind === 'assistant_text_delta') {
        fullText += event.text;
      }
      onEvent(event);
    }
  }

  return fullText;
}

function parseProxyJson(body: string, contentType: string): unknown {
  const trimmed = body.trim();
  if (!trimmed) {
    return {};
  }

  if (contentType.toLowerCase().includes('text/html') || /^<!doctype\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    throw new Error('网页版本地模型代理没有返回 JSON，请确认正在通过 npm run dev 启动调试服务。');
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error('网页版本地模型代理返回的不是有效 JSON。');
  }
}

function readProxyContent(payload: unknown): string {
  if (!isRecord(payload)) return '';
  return typeof payload.content === 'string' ? payload.content.trim() : '';
}

function readProxyError(payload: unknown, status: number): string {
  if (isRecord(payload) && typeof payload.error === 'string' && payload.error.trim()) {
    return `网页版本地模型代理请求失败：${payload.error.trim()}`;
  }

  return `网页版本地模型代理请求失败：HTTP ${status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
