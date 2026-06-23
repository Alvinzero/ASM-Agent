import type { CompleteChatRequest } from './ModelAdapter';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readRequiredString(
  payload: Record<string, unknown>,
  key: keyof CompleteChatRequest,
  context: string
): string {
  const value = payload[key];
  if (typeof value !== 'string') {
    throw new Error(`${context} payload.${key} must be a string.`);
  }

  return value;
}

function readOptionalMessages(payload: Record<string, unknown>, context: string): CompleteChatRequest['messages'] {
  const value = payload.messages;
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`${context} payload.messages must be an array.`);
  }

  return value.map((message, index) => {
    if (!isRecord(message)) {
      throw new Error(`${context} payload.messages[${index}] must be an object.`);
    }

    if (message.role !== 'assistant' && message.role !== 'user') {
      throw new Error(`${context} payload.messages[${index}].role must be assistant or user.`);
    }

    if (typeof message.content !== 'string') {
      throw new Error(`${context} payload.messages[${index}].content must be a string.`);
    }

    return {
      role: message.role,
      content: message.content
    };
  });
}

export function readCompleteChatRequest(
  payload: unknown,
  context = 'agent:completeChat'
): CompleteChatRequest {
  if (!isRecord(payload)) {
    throw new Error(`${context} payload must be an object.`);
  }

  return {
    provider: readRequiredString(payload, 'provider', context),
    label: readRequiredString(payload, 'label', context),
    apiKey: readRequiredString(payload, 'apiKey', context),
    baseUrl: readRequiredString(payload, 'baseUrl', context),
    modelId: readRequiredString(payload, 'modelId', context),
    prompt: readRequiredString(payload, 'prompt', context),
    systemPrompt: readRequiredString(payload, 'systemPrompt', context),
    messages: readOptionalMessages(payload, context)
  };
}
