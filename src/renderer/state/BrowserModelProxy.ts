import type { CompleteChatRequest } from '../../shared/agent/ModelAdapter';

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
type StreamChunkHandler = (chunk: string) => void;

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
  onChunk: StreamChunkHandler,
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
      const event = readSseEvent(block);
      if (!event) continue;
      if (event.done) {
        streamDone = true;
        break;
      }
      if (event.error) {
        throw new Error(`网页版本地流式模型代理请求失败：${event.error}`);
      }
      if (event.content) {
        fullText += event.content;
        onChunk(event.content);
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim() && !streamDone) {
    const event = readSseEvent(buffer);
    if (event?.error) {
      throw new Error(`网页版本地流式模型代理请求失败：${event.error}`);
    }
    if (event?.content) {
      fullText += event.content;
      onChunk(event.content);
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

function drainSseBuffer(buffer: string): { blocks: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n\n');
  return {
    blocks: parts.slice(0, -1),
    rest: parts[parts.length - 1] ?? ''
  };
}

function readSseEvent(block: string): { content?: string; done?: boolean; error?: string } | null {
  const dataLines: string[] = [];
  let eventName = 'message';

  for (const rawLine of block.split('\n')) {
    const line = rawLine.trimEnd();
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }

  if (dataLines.length === 0) return null;

  const data = dataLines.join('\n').trim();
  if (!data) return null;
  if (data === '[DONE]') return { done: true };
  if (eventName === 'error') return { error: data };

  const payload = parseProxyJson(data, 'application/json');
  if (isRecord(payload) && typeof payload.error === 'string') {
    return { error: payload.error };
  }

  const content = readOpenAiDeltaContent(payload) || readProxyContent(payload);
  return content ? { content } : null;
}

function readOpenAiDeltaContent(payload: unknown): string {
  if (!isRecord(payload)) return '';
  const choices = payload.choices;
  if (!Array.isArray(choices)) return '';
  const [firstChoice] = choices;
  if (!isRecord(firstChoice)) return '';
  const delta = firstChoice.delta;
  if (!isRecord(delta)) return '';
  return typeof delta.content === 'string' ? delta.content : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
