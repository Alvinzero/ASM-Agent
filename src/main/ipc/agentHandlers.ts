import { ipcMain } from 'electron';
import { AgentService } from '../../shared/agent/AgentService';
import { readCompleteChatRequest } from '../../shared/agent/CompleteChatRequestValidation';
import type { PlanRequest } from '../../shared/agent/GenerationPlanner';
import { completeOpenAiCompatibleChat } from '../../shared/agent/ModelAdapter';
import { BuiltInSpecRepository } from '../../shared/spec/BuiltInSpecRepository';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readPlanRequest(payload: unknown): PlanRequest {
  if (!isRecord(payload)) {
    throw new Error('agent:createPlan payload must be an object.');
  }

  if (typeof payload.chipId !== 'string') {
    throw new Error('agent:createPlan payload.chipId must be a string.');
  }

  if (typeof payload.requirement !== 'string') {
    throw new Error('agent:createPlan payload.requirement must be a string.');
  }

  return {
    chipId: payload.chipId,
    requirement: payload.requirement
  };
}

export function registerAgentHandlers(): void {
  const service = new AgentService(new BuiltInSpecRepository());

  ipcMain.handle('agent:createPlan', (_event, payload: unknown) => {
    return service.createPlan(readPlanRequest(payload));
  });

  ipcMain.handle('agent:completeChat', (_event, payload: unknown) => {
    return completeOpenAiCompatibleChat(readCompleteChatRequest(payload));
  });
}
