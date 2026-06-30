import packageJson from '../../../package.json';
import type { UpdateSnapshot } from '../../shared/updater/UpdateSnapshot';

function buildUnsupportedSnapshot(): UpdateSnapshot {
  return {
    status: 'unsupported',
    version: window.asmAgent?.version ?? packageJson.version,
    message: '自动更新仅在 Electron 安装版中可用。'
  };
}

export async function getUpdateState(): Promise<UpdateSnapshot> {
  if (!window.asmAgent?.getUpdateState) return buildUnsupportedSnapshot();
  return window.asmAgent.getUpdateState();
}

export async function checkForUpdates(): Promise<UpdateSnapshot> {
  if (!window.asmAgent?.checkForUpdates) return buildUnsupportedSnapshot();
  return window.asmAgent.checkForUpdates();
}

export function onUpdateStateChange(listener: (snapshot: UpdateSnapshot) => void): () => void {
  if (!window.asmAgent?.onUpdateStateChange) return () => undefined;
  return window.asmAgent.onUpdateStateChange(listener);
}

export async function quitAndInstallUpdate(): Promise<void> {
  if (!window.asmAgent?.quitAndInstallUpdate) return;
  await window.asmAgent.quitAndInstallUpdate();
}
