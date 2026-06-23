import { app, ipcMain } from 'electron';
import path from 'node:path';

import { readAuthLoginPayload, readAuthRegisterPayload } from '../../shared/auth/AuthPayloadValidation';
import { SqlUserAuthStore } from '../../shared/auth/SqlUserAuthStore';

let authStore: SqlUserAuthStore | null = null;

function getAuthStore(): SqlUserAuthStore {
  authStore ??= new SqlUserAuthStore(path.join(app.getPath('userData'), 'asm-agent.sqlite'));
  return authStore;
}

export function closeAuthStore(): void {
  authStore?.close();
  authStore = null;
}

export function registerAuthHandlers(): void {
  ipcMain.handle('auth:currentUser', () => getAuthStore().getCurrentUser());

  ipcMain.handle('auth:login', (_event, payload: unknown) => {
    const input = readAuthLoginPayload(payload);
    return getAuthStore().loginUser(input);
  });

  ipcMain.handle('auth:register', (_event, payload: unknown) => {
    const input = readAuthRegisterPayload(payload);
    return getAuthStore().registerUser(input);
  });

  ipcMain.handle('auth:logout', () => getAuthStore().logoutUser());
}
