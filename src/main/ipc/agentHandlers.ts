import { ipcMain } from 'electron';
import { AgentService } from '../../shared/agent/AgentService';
import { readCompleteChatRequest } from '../../shared/agent/CompleteChatRequestValidation';
import type { PlanRequest } from '../../shared/agent/GenerationPlanner';
import { completeOpenAiCompatibleChat, streamOpenAiCompatibleChat } from '../../shared/agent/ModelAdapter';
import { BuiltInSpecRepository } from '../../shared/spec/BuiltInSpecRepository';

const streamControllers = new Map<string, AbortController>();

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

function readStreamRequest(payload: unknown): { streamId: string; request: ReturnType<typeof readCompleteChatRequest> } {
  if (!isRecord(payload)) {
    throw new Error('agent:completeChatStream payload must be an object.');
  }

  if (typeof payload.streamId !== 'string' || payload.streamId.trim().length === 0) {
    throw new Error('agent:completeChatStream payload.streamId must be a non-empty string.');
  }

  return {
    streamId: payload.streamId,
    request: readCompleteChatRequest(payload.payload, 'agent:completeChatStream')
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

  ipcMain.handle('agent:completeChatStream:start', async (event, payload: unknown) => {
    const { streamId, request } = readStreamRequest(payload);
    const previousController = streamControllers.get(streamId);
    if (previousController) {
      previousController.abort();
      streamControllers.delete(streamId);
    }

    const controller = new AbortController();
    streamControllers.set(streamId, controller);

    try {
      return await streamOpenAiCompatibleChat(
        request,
        (modelEvent) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('agent:completeChatStream:event', { streamId, event: modelEvent });
          }
        },
        fetch,
        controller.signal
      );
    } catch (caught) {
      if (controller.signal.aborted) {
        return '';
      }
      throw caught;
    } finally {
      streamControllers.delete(streamId);
    }
  });

  ipcMain.handle('agent:completeChatStream:stop', (_event, streamId: unknown) => {
    if (typeof streamId !== 'string') return false;
    const controller = streamControllers.get(streamId);
    if (!controller) return false;
    controller.abort();
    streamControllers.delete(streamId);
    return true;
  });
}
