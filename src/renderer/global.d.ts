import type { PlanResult } from '../shared/agent/GenerationPlanner';
import type { CompleteChatRequest, ModelStreamEventHandler } from '../shared/agent/ModelAdapter';
import type { AuthLoginPayload, AuthOkResult, AuthRegisterPayload, AuthUserProfile } from '../shared/auth/UserAuthTypes';
import type { GeneratedProject } from '../shared/project/ProjectTypes';
import type { UpdateSnapshot } from '../shared/updater/UpdateSnapshot';

interface GenerateProjectPayload {
  projectName: string;
  requirement: string;
  plan: Extract<PlanResult, { status: 'ready' }>['plan'];
}

interface SaveAsmFilePayload {
  sessionId: string;
  file: {
    path: string;
    content: string;
  };
}

interface SavedAsmFile {
  path: string;
  absolutePath: string;
  sessionDir: string;
}

interface OpenFilePayload {
  path: string;
}

export interface AsmAgentApi {
  version: string;
  createPlan(payload: { chipId: 'HK64S8x'; requirement: string }): Promise<PlanResult>;
  generateProject(payload: GenerateProjectPayload): Promise<GeneratedProject>;
  saveAsmFile?(payload: SaveAsmFilePayload): Promise<SavedAsmFile>;
  openFile?(payload: OpenFilePayload): Promise<{ ok: true }>;
  completeChat?(payload: CompleteChatRequest, signal?: AbortSignal): Promise<string>;
  completeChatStream?(payload: CompleteChatRequest, onEvent: ModelStreamEventHandler, signal?: AbortSignal): Promise<string>;
  getCurrentUser?(): Promise<AuthUserProfile | null>;
  loginUser?(payload: AuthLoginPayload): Promise<AuthUserProfile>;
  registerUser?(payload: AuthRegisterPayload): Promise<AuthUserProfile>;
  logoutUser?(): Promise<AuthOkResult>;
  getUpdateState?(): Promise<UpdateSnapshot>;
  checkForUpdates?(): Promise<UpdateSnapshot>;
  downloadUpdate?(): Promise<UpdateSnapshot>;
  onUpdateStateChange?(listener: (snapshot: UpdateSnapshot) => void): () => void;
  quitAndInstallUpdate?(): Promise<{ ok: true }>;
}

declare global {
  interface Window {
    asmAgent?: AsmAgentApi;
  }
}

export {};
