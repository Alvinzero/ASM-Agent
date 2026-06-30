import { contextBridge, ipcRenderer } from 'electron';
import packageJson from '../../package.json';
import type { CompleteChatMessage, ModelStreamEvent } from '../shared/agent/ModelAdapter';
import type { AuthLoginPayload, AuthOkResult, AuthRegisterPayload, AuthUserProfile } from '../shared/auth/UserAuthTypes';
import type { UpdateSnapshot } from '../shared/updater/UpdateSnapshot';

type CreatePlanPayload = {
  chipId: string;
  requirement: string;
};

type CompleteChatPayload = {
  provider: string;
  label: string;
  apiKey: string;
  baseUrl: string;
  modelId: string;
  prompt: string;
  systemPrompt: string;
  messages?: CompleteChatMessage[];
};

type CompleteChatStreamPayload = {
  streamId: string;
  event: ModelStreamEvent;
};

type SaveAsmFilePayload = {
  sessionId: string;
  file: {
    path: string;
    content: string;
  };
};

type OpenFilePayload = {
  path: string;
};

type UpdateStateChangeHandler = (snapshot: UpdateSnapshot) => void;

type AsmAgentApi = {
  version: string;
  createPlan(payload: CreatePlanPayload): Promise<unknown>;
  generateProject(payload: unknown): Promise<unknown>;
  saveAsmFile(payload: SaveAsmFilePayload): Promise<unknown>;
  openFile(payload: OpenFilePayload): Promise<unknown>;
  completeChat(payload: CompleteChatPayload): Promise<string>;
  completeChatStream(payload: CompleteChatPayload, onEvent: (event: ModelStreamEvent) => void, signal?: AbortSignal): Promise<string>;
  getCurrentUser(): Promise<AuthUserProfile | null>;
  loginUser(payload: AuthLoginPayload): Promise<AuthUserProfile>;
  registerUser(payload: AuthRegisterPayload): Promise<AuthUserProfile>;
  logoutUser(): Promise<AuthOkResult>;
  getUpdateState(): Promise<UpdateSnapshot>;
  checkForUpdates(): Promise<UpdateSnapshot>;
  onUpdateStateChange(listener: UpdateStateChangeHandler): () => void;
  quitAndInstallUpdate(): Promise<{ ok: true }>;
};

function createStreamId(): string {
  return `stream-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function completeChatStream(
  payload: CompleteChatPayload,
  onEvent: (event: ModelStreamEvent) => void,
  signal?: AbortSignal
): Promise<string> {
  const streamId = createStreamId();
  const listener = (_event: Electron.IpcRendererEvent, message: CompleteChatStreamPayload) => {
    if (message.streamId !== streamId) return;
    onEvent(message.event);
  };
  const stop = () => {
    void ipcRenderer.invoke('agent:completeChatStream:stop', streamId);
  };

  ipcRenderer.on('agent:completeChatStream:event', listener);
  signal?.addEventListener('abort', stop, { once: true });

  return ipcRenderer
    .invoke('agent:completeChatStream:start', { streamId, payload })
    .finally(() => {
      signal?.removeEventListener('abort', stop);
      ipcRenderer.removeListener('agent:completeChatStream:event', listener);
    });
}

const api: AsmAgentApi = {
  version: packageJson.version,
  createPlan: (payload) => ipcRenderer.invoke('agent:createPlan', payload),
  generateProject: (payload) => ipcRenderer.invoke('project:generate', payload),
  saveAsmFile: (payload) => ipcRenderer.invoke('file:saveAsm', payload),
  openFile: (payload) => ipcRenderer.invoke('file:open', payload),
  completeChat: (payload) => ipcRenderer.invoke('agent:completeChat', payload),
  completeChatStream,
  getCurrentUser: () => ipcRenderer.invoke('auth:currentUser'),
  loginUser: (payload) => ipcRenderer.invoke('auth:login', payload),
  registerUser: (payload) => ipcRenderer.invoke('auth:register', payload),
  logoutUser: () => ipcRenderer.invoke('auth:logout'),
  getUpdateState: () => ipcRenderer.invoke('updater:getState'),
  checkForUpdates: () => ipcRenderer.invoke('updater:checkForUpdates'),
  onUpdateStateChange: (listener) => {
    const handleUpdateStateChange = (_event: Electron.IpcRendererEvent, snapshot: UpdateSnapshot) => {
      listener(snapshot);
    };

    ipcRenderer.on('updater:event', handleUpdateStateChange);
    return () => {
      ipcRenderer.removeListener('updater:event', handleUpdateStateChange);
    };
  },
  quitAndInstallUpdate: () => ipcRenderer.invoke('updater:quitAndInstall')
};

contextBridge.exposeInMainWorld('asmAgent', api);
