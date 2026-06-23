export interface ModelPrompt {
  system: string;
  user: string;
}

export interface ModelAdapter {
  complete(prompt: ModelPrompt): Promise<string>;
}

export interface OpenAiCompatibleChatConfig {
  provider: string;
  label: string;
  apiKey: string;
  baseUrl: string;
  modelId: string;
}

export interface CompleteChatMessage {
  role: 'assistant' | 'user';
  content: string;
}

export interface OpenAiCompatibleMessage {
  role: 'assistant' | 'system' | 'user';
  content: string;
}

export interface CompleteChatRequest extends OpenAiCompatibleChatConfig {
  prompt: string;
  systemPrompt: string;
  messages?: CompleteChatMessage[];
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class DisabledModelAdapter implements ModelAdapter {
  async complete(_prompt: ModelPrompt): Promise<string> {
    throw new Error('Local model adapter is not configured in this MVP build.');
  }
}

export class OpenAiCompatibleModelAdapter implements ModelAdapter {
  constructor(
    private readonly config: OpenAiCompatibleChatConfig,
    private readonly fetchImpl: FetchLike = fetch
  ) {}

  async complete(prompt: ModelPrompt): Promise<string> {
    return completeOpenAiCompatibleChat(
      {
        ...this.config,
        prompt: prompt.user,
        systemPrompt: prompt.system
      },
      this.fetchImpl
    );
  }
}

export async function completeOpenAiCompatibleChat(
  request: CompleteChatRequest,
  fetchImpl: FetchLike = fetch
): Promise<string> {
  const endpoint = buildChatCompletionsUrl(request.baseUrl);
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${request.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: request.modelId,
      messages: buildOpenAiCompatibleMessages(request.systemPrompt, request.prompt, request.messages),
      temperature: 0.3
    })
  });

  const responseText = await readResponseText(response);
  if (!response.ok) {
    throw new Error(`${request.label} API 请求失败：HTTP ${response.status}${formatErrorPreview(responseText)}`);
  }

  const payload = parseJsonResponse({
    body: responseText,
    contentType: response.headers.get('Content-Type') ?? '',
    endpoint,
    label: request.label
  });
  const content = readFirstAssistantMessage(payload);
  if (!content) {
    throw new Error(`${request.label} API 返回为空或格式不兼容。`);
  }

  return content;
}

export function buildOpenAiCompatibleMessages(
  systemPrompt: string,
  prompt: string,
  messages?: CompleteChatMessage[]
): OpenAiCompatibleMessage[] {
  const userPrompt = prompt.trim();
  const history = (messages ?? [])
    .map((message) => ({
      role: message.role,
      content: message.content.trim()
    }))
    .filter((message) => message.content);
  const historyAlreadyIncludesCurrentPrompt =
    history.length > 0 && history[history.length - 1]?.role === 'user' && history[history.length - 1]?.content === userPrompt;

  return [
    { role: 'system', content: systemPrompt },
    ...history,
    ...(historyAlreadyIncludesCurrentPrompt ? [] : [{ role: 'user' as const, content: userPrompt }])
  ];
}

export function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/g, '');
  if (!normalized) {
    throw new Error('模型 Base URL 不能为空。');
  }

  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function formatErrorPreview(body: string): string {
  const preview = body.trim();
  if (!preview) return '';
  if (looksLikeHtml(preview, '')) {
    return '，返回了 HTML 错误页面，请检查 Base URL 是否填成了官网、控制台或文档地址。';
  }

  return `，${preview.slice(0, 300)}`;
}

function parseJsonResponse(input: {
  body: string;
  contentType: string;
  endpoint: string;
  label: string;
}): unknown {
  const body = input.body.trim();
  if (!body) {
    throw new Error(`${input.label} API 返回为空。请检查 Base URL、Model ID 和 API Key 是否正确。`);
  }

  if (looksLikeHtml(body, input.contentType)) {
    throw new Error(
      `${input.label} API 返回的不是 JSON，而是 HTML 页面。请检查 Base URL 是否为 OpenAI 兼容接口地址，例如以 /v1 或 /compatible-mode/v1 结尾；不要填写官网、控制台或文档地址。当前请求地址：${input.endpoint}`
    );
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(
      `${input.label} API 返回的不是有效 JSON。请检查 Base URL 和该模型服务是否兼容 OpenAI Chat Completions。当前请求地址：${input.endpoint}`
    );
  }
}

function looksLikeHtml(body: string, contentType: string): boolean {
  return contentType.toLowerCase().includes('text/html') || /^<!doctype\s+html/i.test(body) || /^<html[\s>]/i.test(body);
}

function readFirstAssistantMessage(payload: unknown): string {
  if (!isRecord(payload)) return '';
  const choices = payload.choices;
  if (!Array.isArray(choices)) return '';
  const [firstChoice] = choices;
  if (!isRecord(firstChoice)) return '';
  const message = firstChoice.message;
  if (!isRecord(message)) return '';
  return typeof message.content === 'string' ? message.content.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
