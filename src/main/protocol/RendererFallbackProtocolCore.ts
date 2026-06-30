import path from 'node:path';

import { readCompleteChatRequest } from '../../shared/agent/CompleteChatRequestValidation';
import type {
  CompleteChatRequest as ModelCompleteChatRequest,
  ModelStreamEventHandler
} from '../../shared/agent/ModelAdapter';
import { assertPathInsideRoot, type SavedAsmFile } from '../../shared/project/SessionFileStore';
import type { GeneratedFile } from '../../shared/project/ProjectTypes';

export interface RendererFallbackDependencies {
  completeChat: (
    request: ModelCompleteChatRequest,
    fetchImpl?: typeof fetch,
    signal?: AbortSignal
  ) => Promise<string>;
  streamChat: (
    request: ModelCompleteChatRequest,
    onEvent: ModelStreamEventHandler,
    fetchImpl?: typeof fetch,
    signal?: AbortSignal
  ) => Promise<string>;
  saveSessionAsmFile: (rootDir: string, sessionId: string, file: GeneratedFile) => SavedAsmFile;
  showItemInFolder: (targetPath: string) => void;
  documentsDir: string;
  getUpdateState: () => import('../../shared/updater/UpdateSnapshot').UpdateSnapshot;
  checkForUpdates: () => Promise<import('../../shared/updater/UpdateSnapshot').UpdateSnapshot>;
  downloadUpdate: () => Promise<import('../../shared/updater/UpdateSnapshot').UpdateSnapshot>;
  quitAndInstallUpdate: () => void;
}

function getSessionOutputRoot(documentsDir: string): string {
  return path.join(documentsDir, 'ASM Agent', 'sessions');
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json'
    }
  });
}

function readErrorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : '未知错误';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readSavePayload(payload: unknown): { sessionId: string; file: GeneratedFile } {
  if (!isRecord(payload)) {
    throw new Error('桌面本地文件保存请求格式不正确。');
  }

  if (typeof payload.sessionId !== 'string') {
    throw new Error('桌面本地文件保存缺少 sessionId。');
  }

  if (!isRecord(payload.file) || typeof payload.file.path !== 'string' || typeof payload.file.content !== 'string') {
    throw new Error('桌面本地文件保存缺少 main.asm 内容。');
  }

  return {
    sessionId: payload.sessionId,
    file: {
      path: payload.file.path,
      content: payload.file.content
    }
  };
}

function readOpenPayload(payload: unknown): { path: string } {
  if (!isRecord(payload) || typeof payload.path !== 'string') {
    throw new Error('桌面本地文件打开请求格式不正确。');
  }

  return {
    path: payload.path
  };
}

function encodeStreamEvent(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function serializeModelEvent(event: Parameters<ModelStreamEventHandler>[0]): string {
  if (event.kind === 'assistant_text_delta') {
    return `data: ${JSON.stringify({ choices: [{ delta: { content: event.text } }] })}\n\n`;
  }

  if (event.kind === 'assistant_reasoning_delta') {
    return `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: event.text } }] })}\n\n`;
  }

  if (event.kind === 'error') {
    return `event: error\ndata: ${event.message}\n\n`;
  }

  return 'data: [DONE]\n\n';
}

export async function createRendererFallbackResponse(
  request: Request,
  dependencies: RendererFallbackDependencies
): Promise<Response> {
  const url = new URL(request.url);
  const route = `${url.pathname}${url.search}`.replace(/\/+$/, '') || '/';

  try {
    if (request.method !== 'POST') {
      return jsonResponse({ error: '仅支持 POST 请求。' }, 405);
    }

    if (route === '/api/complete-chat') {
      const payload = readCompleteChatRequest(await request.json());
      const content = await dependencies.completeChat(payload, fetch);
      return jsonResponse({ content });
    }

    if (route === '/api/complete-chat-stream') {
      const payload = readCompleteChatRequest(await request.json());
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          let completed = false;
          try {
            await dependencies.streamChat(
              payload,
              (event) => {
                if (event.kind === 'completed') {
                  completed = true;
                }
                controller.enqueue(encodeStreamEvent(serializeModelEvent(event)));
              },
              fetch
            );

            if (!completed) {
              controller.enqueue(encodeStreamEvent('data: [DONE]\n\n'));
            }
          } catch (caught) {
            controller.enqueue(encodeStreamEvent(`event: error\ndata: ${readErrorMessage(caught)}\n\n`));
          } finally {
            controller.close();
          }
        }
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache'
        }
      });
    }

    if (route === '/api/session-file/save') {
      const payload = readSavePayload(await request.json());
      const saved = dependencies.saveSessionAsmFile(getSessionOutputRoot(dependencies.documentsDir), payload.sessionId, payload.file);
      return jsonResponse(saved);
    }

    if (route === '/api/session-file/open') {
      const payload = readOpenPayload(await request.json());
      const root = getSessionOutputRoot(dependencies.documentsDir);
      assertPathInsideRoot(root, payload.path, 'open file');
      dependencies.showItemInFolder(payload.path);
      return jsonResponse({ ok: true });
    }

    if (route === '/api/updater/state') {
      return jsonResponse(dependencies.getUpdateState());
    }

    if (route === '/api/updater/check') {
      return jsonResponse(await dependencies.checkForUpdates());
    }

    if (route === '/api/updater/download') {
      return jsonResponse(await dependencies.downloadUpdate());
    }

    if (route === '/api/updater/quit-and-install') {
      dependencies.quitAndInstallUpdate();
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: `未知桌面回退协议路径：${route}` }, 404);
  } catch (caught) {
    return jsonResponse({ error: readErrorMessage(caught) }, 500);
  }
}
