import { contextBridge, ipcRenderer } from 'electron';
import type { AuthLoginPayload, AuthOkResult, AuthRegisterPayload, AuthUserProfile } from '../shared/auth/UserAuthTypes';

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

type AsmAgentApi = {
  version: '0.1.0';
  createPlan(payload: CreatePlanPayload): Promise<unknown>;
  generateProject(payload: unknown): Promise<unknown>;
  saveAsmFile(payload: SaveAsmFilePayload): Promise<unknown>;
  openFile(payload: OpenFilePayload): Promise<unknown>;
  completeChat(payload: CompleteChatPayload): Promise<string>;
  getCurrentUser(): Promise<AuthUserProfile | null>;
  loginUser(payload: AuthLoginPayload): Promise<AuthUserProfile>;
  registerUser(payload: AuthRegisterPayload): Promise<AuthUserProfile>;
  logoutUser(): Promise<AuthOkResult>;
};

const api: AsmAgentApi = {
  version: '0.1.0',
  createPlan: (payload) => ipcRenderer.invoke('agent:createPlan', payload),
  generateProject: (payload) => ipcRenderer.invoke('project:generate', payload),
  saveAsmFile: (payload) => ipcRenderer.invoke('file:saveAsm', payload),
  openFile: (payload) => ipcRenderer.invoke('file:open', payload),
  completeChat: (payload) => ipcRenderer.invoke('agent:completeChat', payload),
  getCurrentUser: () => ipcRenderer.invoke('auth:currentUser'),
  loginUser: (payload) => ipcRenderer.invoke('auth:login', payload),
  registerUser: (payload) => ipcRenderer.invoke('auth:register', payload),
  logoutUser: () => ipcRenderer.invoke('auth:logout')
};

contextBridge.exposeInMainWorld('asmAgent', api);
