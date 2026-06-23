import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

import { readCompleteChatRequest } from './src/shared/agent/CompleteChatRequestValidation';
import { buildOpenAiCompatibleMessages, completeOpenAiCompatibleChat } from './src/shared/agent/ModelAdapter';
import { readAuthLoginPayload, readAuthRegisterPayload } from './src/shared/auth/AuthPayloadValidation';
import { SqlUserAuthStore } from './src/shared/auth/SqlUserAuthStore';
import { assertPathInsideRoot, getDefaultSessionOutputRoot, saveSessionAsmFile } from './src/shared/project/SessionFileStore';

function localModelProxyPlugin(): Plugin {
  return {
    name: 'asm-agent-local-model-proxy',
    configureServer(server) {
      const authStore = new SqlUserAuthStore(path.join(process.cwd(), 'output', 'dev-data', 'asm-agent-auth.sqlite'));

      server.middlewares.use('/api/health', (_req, res) => {
        sendJson(res, 200, { ok: true });
      });

      server.middlewares.use('/api/auth/current-user', (req, res) => {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        sendJson(res, 200, authStore.getCurrentUser());
      });

      server.middlewares.use('/api/auth/login', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        try {
          const body = await readJsonBody(req);
          sendJson(res, 200, authStore.loginUser(readAuthLoginPayload(body, 'dev:authLogin')));
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : 'Unknown auth login error.';
          sendJson(res, 400, { error: message });
        }
      });

      server.middlewares.use('/api/auth/register', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        try {
          const body = await readJsonBody(req);
          sendJson(res, 200, authStore.registerUser(readAuthRegisterPayload(body, 'dev:authRegister')));
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : 'Unknown auth register error.';
          sendJson(res, 400, { error: message });
        }
      });

      server.middlewares.use('/api/auth/logout', (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        sendJson(res, 200, authStore.logoutUser());
      });

      server.middlewares.use('/api/session-file/save', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        try {
          const body = await readJsonBody(req);
          const input = readSaveAsmFilePayload(body);
          sendJson(res, 200, saveSessionAsmFile(getDefaultSessionOutputRoot(), input.sessionId, input.file));
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : 'Unknown session file save error.';
          sendJson(res, 400, { error: message });
        }
      });

      server.middlewares.use('/api/session-file/open', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        try {
          const body = await readJsonBody(req);
          const input = readOpenFilePayload(body);
          assertPathInsideRoot(getDefaultSessionOutputRoot(), input.path, 'open file');
          await openLocalPath(input.path);
          sendJson(res, 200, { ok: true });
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : 'Unknown session file open error.';
          sendJson(res, 400, { error: message });
        }
      });

      server.middlewares.use('/api/complete-chat', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        try {
          const body = await readJsonBody(req);
          const request = readCompleteChatRequest(body, 'dev:completeChat');
          const content = await completeOpenAiCompatibleChat(request);
          sendJson(res, 200, { content });
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : 'Unknown proxy error.';
          sendJson(res, 502, { error: message });
        }
      });

      server.middlewares.use('/api/complete-chat-stream', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method not allowed.' });
          return;
        }

        prepareSseResponse(res);

        try {
          const body = await readJsonBody(req);
          const request = readCompleteChatRequest(body, 'dev:completeChatStream');
          const upstream = await fetch(buildChatCompletionsUrl(request.baseUrl), {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${request.apiKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: request.modelId,
              messages: buildOpenAiCompatibleMessages(request.systemPrompt, request.prompt, request.messages),
              temperature: 0.3,
              stream: true
            })
          });

          if (!upstream.ok) {
            writeSseEvent(res, 'error', `${request.label} API 请求失败：HTTP ${upstream.status}${await readErrorPreview(upstream)}`);
            writeSseDone(res);
            return;
          }

          const contentType = upstream.headers.get('Content-Type') ?? '';
          if (!contentType.toLowerCase().includes('text/event-stream')) {
            writeNonStreamingFallback(res, request.label, await upstream.text());
            return;
          }

          if (!upstream.body) {
            writeSseEvent(res, 'error', `${request.label} API 没有返回可读取的数据流。`);
            writeSseDone(res);
            return;
          }

          const reader = upstream.body.getReader();
          while (true) {
            const readResult = await reader.read();
            if (readResult.done) break;
            res.write(Buffer.from(readResult.value));
          }
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : 'Unknown stream proxy error.';
          writeSseEvent(res, 'error', message);
        } finally {
          res.end();
        }
      });
    }
  };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }

  const rawBody = Buffer.concat(chunks).toString('utf8').trim();
  if (!rawBody) {
    throw new Error('Request body must be JSON.');
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}

function readSaveAsmFilePayload(payload: unknown): { sessionId: string; file: { path: string; content: string } } {
  if (!isRecord(payload)) {
    throw new Error('session-file/save payload must be an object.');
  }

  if (typeof payload.sessionId !== 'string') {
    throw new Error('session-file/save payload.sessionId must be a string.');
  }

  if (!isRecord(payload.file)) {
    throw new Error('session-file/save payload.file must be an object.');
  }

  if (typeof payload.file.path !== 'string') {
    throw new Error('session-file/save payload.file.path must be a string.');
  }

  if (typeof payload.file.content !== 'string') {
    throw new Error('session-file/save payload.file.content must be a string.');
  }

  return {
    sessionId: payload.sessionId,
    file: {
      path: payload.file.path,
      content: payload.file.content
    }
  };
}

function readOpenFilePayload(payload: unknown): { path: string } {
  if (!isRecord(payload)) {
    throw new Error('session-file/open payload must be an object.');
  }

  if (typeof payload.path !== 'string') {
    throw new Error('session-file/open payload.path must be a string.');
  }

  return { path: payload.path };
}

function openLocalPath(filePath: string): Promise<void> {
  const command = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args =
    process.platform === 'win32'
      ? [`/select,${filePath}`]
      : process.platform === 'darwin'
        ? ['-R', filePath]
        : [path.dirname(filePath)];

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: path.dirname(filePath),
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });

    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/g, '');
  if (!normalized) {
    throw new Error('模型 Base URL 不能为空。');
  }

  return normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
}

function prepareSseResponse(res: ServerResponse): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
}

function writeSseEvent(res: ServerResponse, eventName: 'error' | 'message', data: unknown): void {
  if (eventName !== 'message') {
    res.write(`event: ${eventName}\n`);
  }
  res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
}

function writeSseDone(res: ServerResponse): void {
  res.write('data: [DONE]\n\n');
}

async function readErrorPreview(response: Response): Promise<string> {
  const text = (await response.text()).trim();
  return text ? `，${text.slice(0, 300)}` : '';
}

function writeNonStreamingFallback(res: ServerResponse, label: string, body: string): void {
  try {
    const content = readFirstAssistantMessage(JSON.parse(body) as unknown);
    if (!content) {
      writeSseEvent(res, 'error', `${label} API 返回为空或格式不兼容。`);
      writeSseDone(res);
      return;
    }

    writeSseEvent(res, 'message', { choices: [{ delta: { content } }] });
    writeSseDone(res);
  } catch {
    writeSseEvent(res, 'error', `${label} API 返回的不是有效 JSON，也不是 SSE 流。`);
    writeSseDone(res);
  }
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

export default defineConfig({
  base: './',
  plugins: [react(), localModelProxyPlugin()],
  root: 'src/renderer',
  build: {
    outDir: '../../dist-renderer',
    emptyOutDir: true
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  }
});
