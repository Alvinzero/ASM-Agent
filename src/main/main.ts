import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { closeAuthStore, registerAuthHandlers } from './ipc/authHandlers';
import { registerAgentHandlers } from './ipc/agentHandlers';
import { registerFileHandlers } from './ipc/fileHandlers';
import { registerProjectHandlers } from './ipc/projectHandlers';
import { checkForAppUpdates, registerUpdateHandlers } from './ipc/updateHandlers';
import { registerRendererFallbackProtocol } from './protocol/RendererFallbackProtocol';

function getTrustedDevServerUrl(): string | undefined {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (!devServerUrl) return undefined;

  const url = new URL(devServerUrl);
  const isTrustedHost = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  const isTrustedPort = url.port === '5173';
  if (url.protocol === 'http:' && isTrustedHost && isTrustedPort) return url.toString();

  throw new Error(`Refusing to load untrusted dev server URL: ${devServerUrl}`);
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#f6f8fc',
    title: 'ASM Agent',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devServerUrl = getTrustedDevServerUrl();
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(app.getAppPath(), 'dist-renderer/index.html'));
  }

  mainWindow.webContents.once('did-finish-load', () => {
    void checkForAppUpdates();
  });
}

registerAgentHandlers();
registerAuthHandlers();
registerFileHandlers();
registerProjectHandlers();
registerUpdateHandlers();

void app.whenReady().then(() => {
  registerRendererFallbackProtocol();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', closeAuthStore);
