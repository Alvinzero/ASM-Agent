import { app, ipcMain, shell } from 'electron';
import path from 'node:path';

import { assertPathInsideRoot, saveSessionAsmFile } from '../../shared/project/SessionFileStore';
import type { GeneratedFile } from '../../shared/project/ProjectTypes';

interface SaveAsmFilePayload {
  sessionId: string;
  file: GeneratedFile;
}

interface OpenFilePayload {
  path: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getSessionOutputRoot(): string {
  return path.join(app.getPath('documents'), 'ASM Agent', 'sessions');
}

function readSaveAsmFilePayload(payload: unknown): SaveAsmFilePayload {
  if (!isRecord(payload)) {
    throw new Error('file:saveAsm payload must be an object.');
  }

  if (typeof payload.sessionId !== 'string') {
    throw new Error('file:saveAsm payload.sessionId must be a string.');
  }

  if (!isRecord(payload.file)) {
    throw new Error('file:saveAsm payload.file must be an object.');
  }

  if (typeof payload.file.path !== 'string') {
    throw new Error('file:saveAsm payload.file.path must be a string.');
  }

  if (typeof payload.file.content !== 'string') {
    throw new Error('file:saveAsm payload.file.content must be a string.');
  }

  return {
    sessionId: payload.sessionId,
    file: {
      path: payload.file.path,
      content: payload.file.content
    }
  };
}

function readOpenFilePayload(payload: unknown): OpenFilePayload {
  if (!isRecord(payload)) {
    throw new Error('file:open payload must be an object.');
  }

  if (typeof payload.path !== 'string') {
    throw new Error('file:open payload.path must be a string.');
  }

  return { path: payload.path };
}

export function registerFileHandlers(): void {
  ipcMain.handle('file:saveAsm', (_event, payload: unknown) => {
    const input = readSaveAsmFilePayload(payload);
    return saveSessionAsmFile(getSessionOutputRoot(), input.sessionId, input.file);
  });

  ipcMain.handle('file:open', async (_event, payload: unknown) => {
    const input = readOpenFilePayload(payload);
    const root = getSessionOutputRoot();
    assertPathInsideRoot(root, input.path, 'open file');

    shell.showItemInFolder(input.path);
    return { ok: true };
  });
}
