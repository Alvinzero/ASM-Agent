import type { PlanResult } from '../shared/agent/GenerationPlanner';
import type { CompleteChatRequest } from '../shared/agent/ModelAdapter';
import type { AuthLoginPayload, AuthOkResult, AuthRegisterPayload, AuthUserProfile } from '../shared/auth/UserAuthTypes';
import type { GeneratedProject } from '../shared/project/ProjectTypes';

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
  createPlan(payload: { chipId: 'HK8S8100X'; requirement: string }): Promise<PlanResult>;
  generateProject(payload: GenerateProjectPayload): Promise<GeneratedProject>;
  saveAsmFile?(payload: SaveAsmFilePayload): Promise<SavedAsmFile>;
  openFile?(payload: OpenFilePayload): Promise<{ ok: true }>;
  completeChat?(payload: CompleteChatRequest, signal?: AbortSignal): Promise<string>;
  completeChatStream?(payload: CompleteChatRequest, onChunk: (chunk: string) => void, signal?: AbortSignal): Promise<string>;
  getCurrentUser?(): Promise<AuthUserProfile | null>;
  loginUser?(payload: AuthLoginPayload): Promise<AuthUserProfile>;
  registerUser?(payload: AuthRegisterPayload): Promise<AuthUserProfile>;
  logoutUser?(): Promise<AuthOkResult>;
}

declare global {
  interface Window {
    asmAgent?: AsmAgentApi;
  }
}

export {};
