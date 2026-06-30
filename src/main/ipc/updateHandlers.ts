import { BrowserWindow, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';
import { app } from 'electron';

import type { UpdateSnapshot } from '../../shared/updater/UpdateSnapshot';
import { AppUpdater } from '../updater/AppUpdater';

const UPDATER_EVENT_CHANNEL = 'updater:event';

let handlersRegistered = false;

const updaterService = new AppUpdater({
  adapter: autoUpdater,
  currentVersion: app.getVersion(),
  isPackaged: app.isPackaged,
  onStateChange: broadcastUpdateState
});

function broadcastUpdateState(snapshot: UpdateSnapshot): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(UPDATER_EVENT_CHANNEL, snapshot);
  }
}

export function registerUpdateHandlers(): void {
  if (handlersRegistered) return;
  handlersRegistered = true;

  ipcMain.handle('updater:getState', () => updaterService.getSnapshot());
  ipcMain.handle('updater:checkForUpdates', () => updaterService.checkForUpdates());
  ipcMain.handle('updater:downloadUpdate', () => updaterService.downloadUpdate());
  ipcMain.handle('updater:quitAndInstall', () => {
    updaterService.quitAndInstall();
    return { ok: true };
  });
}

export function getCurrentUpdateState(): UpdateSnapshot {
  return updaterService.getSnapshot();
}

export async function checkForAppUpdates(): Promise<UpdateSnapshot> {
  return updaterService.checkForUpdates();
}

export async function downloadAppUpdate(): Promise<UpdateSnapshot> {
  return updaterService.downloadUpdate();
}

export function quitAndInstallAppUpdate(): void {
  updaterService.quitAndInstall();
}
