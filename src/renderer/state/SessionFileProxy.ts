import type { GeneratedFile } from '../../shared/project/ProjectTypes';

interface SavedAsmFile {
  path: string;
  absolutePath: string;
  sessionDir: string;
}

const SAVE_SESSION_ASM_ENDPOINT = '/api/session-file/save';
const OPEN_SESSION_FILE_ENDPOINT = '/api/session-file/open';

export async function saveAsmFileViaLocalProxy(
  payload: { sessionId: string; file: GeneratedFile },
  fetchImpl: typeof fetch = fetch
): Promise<SavedAsmFile> {
  const response = await fetchImpl(SAVE_SESSION_ASM_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(readError(body, response.status));
  }

  return readSavedAsmFile(body);
}

export async function openSessionFileViaLocalProxy(payload: { path: string }, fetchImpl: typeof fetch = fetch): Promise<{ ok: true }> {
  const response = await fetchImpl(OPEN_SESSION_FILE_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(readError(body, response.status));
  }

  return { ok: true };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return {};

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error('本地会话文件服务返回的不是有效 JSON。');
  }
}

function readSavedAsmFile(value: unknown): SavedAsmFile {
  if (!isRecord(value)) {
    throw new Error('本地会话文件服务返回格式不正确。');
  }

  if (typeof value.path !== 'string' || typeof value.absolutePath !== 'string' || typeof value.sessionDir !== 'string') {
    throw new Error('本地会话文件服务缺少文件路径。');
  }

  return {
    path: value.path,
    absolutePath: value.absolutePath,
    sessionDir: value.sessionDir
  };
}

function readError(value: unknown, status: number): string {
  if (isRecord(value) && typeof value.error === 'string' && value.error.trim()) {
    return value.error.trim();
  }

  return `本地会话文件服务请求失败：HTTP ${status}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
