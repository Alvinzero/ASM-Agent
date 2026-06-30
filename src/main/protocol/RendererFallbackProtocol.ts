import { app, protocol, shell } from 'electron';
import {
  completeOpenAiCompatibleChat,
  streamOpenAiCompatibleChat,
} from '../../shared/agent/ModelAdapter';
import { saveSessionAsmFile } from '../../shared/project/SessionFileStore';
import { checkForAppUpdates, getCurrentUpdateState, quitAndInstallAppUpdate } from '../ipc/updateHandlers';
import {
  createRendererFallbackResponse,
  type RendererFallbackDependencies
} from './RendererFallbackProtocolCore';

export const RENDERER_FALLBACK_PROTOCOL = 'asm-agent';

if (protocol && typeof protocol.registerSchemesAsPrivileged === 'function') {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: RENDERER_FALLBACK_PROTOCOL,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true
      }
    }
  ]);
}

function buildDefaultDependencies(): RendererFallbackDependencies {
  return {
    completeChat: completeOpenAiCompatibleChat,
    streamChat: streamOpenAiCompatibleChat,
    saveSessionAsmFile,
    showItemInFolder: (targetPath) => {
      shell.showItemInFolder(targetPath);
    },
    documentsDir: app.getPath('documents'),
    getUpdateState: () => getCurrentUpdateState(),
    checkForUpdates: () => checkForAppUpdates(),
    quitAndInstallUpdate: () => {
      quitAndInstallAppUpdate();
    }
  };
}

export function registerRendererFallbackProtocol(dependencies: RendererFallbackDependencies = buildDefaultDependencies()): void {
  protocol.handle(RENDERER_FALLBACK_PROTOCOL, (request) => createRendererFallbackResponse(request, dependencies));
}
