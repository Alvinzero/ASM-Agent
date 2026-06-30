import packageJson from '../../../package.json';
import type { UpdateSnapshot } from '../../shared/updater/UpdateSnapshot';
import { resolveRendererFallbackEndpoint } from './RendererFallbackEndpoint';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const UPDATE_STATE_ENDPOINT = '/api/updater/state';
const UPDATE_CHECK_ENDPOINT = '/api/updater/check';
const UPDATE_QUIT_AND_INSTALL_ENDPOINT = '/api/updater/quit-and-install';
const UPDATE_POLL_INTERVAL_MS = 1500;

function buildUnsupportedSnapshot(): UpdateSnapshot {
  return {
    status: 'unsupported',
    version: window.asmAgent?.version ?? packageJson.version,
    message: '自动更新仅在 Electron 安装版中可用。'
  };
}

function isDesktopFallbackLocation(
  locationLike: Pick<Location, 'protocol'> | undefined = typeof window !== 'undefined' ? window.location : undefined
): boolean {
  return locationLike?.protocol === 'file:';
}

async function readUpdateJson(response: Response): Promise<UpdateSnapshot> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error('桌面更新服务返回为空。');
  }

  const payload = JSON.parse(text) as unknown;
  if (!response.ok) {
    throw new Error(readUpdateError(payload, response.status));
  }

  return readUpdateSnapshot(payload);
}

function readUpdateSnapshot(value: unknown): UpdateSnapshot {
  if (typeof value !== 'object' || value === null) {
    throw new Error('桌面更新服务返回格式不正确。');
  }

  const snapshot = value as Record<string, unknown>;
  if (typeof snapshot.status !== 'string' || typeof snapshot.version !== 'string') {
    throw new Error('桌面更新服务缺少状态字段。');
  }

  return {
    status: snapshot.status as UpdateSnapshot['status'],
    version: snapshot.version,
    availableVersion: typeof snapshot.availableVersion === 'string' ? snapshot.availableVersion : undefined,
    progressPercent: typeof snapshot.progressPercent === 'number' ? snapshot.progressPercent : undefined,
    transferredBytes: typeof snapshot.transferredBytes === 'number' ? snapshot.transferredBytes : undefined,
    totalBytes: typeof snapshot.totalBytes === 'number' ? snapshot.totalBytes : undefined,
    message: typeof snapshot.message === 'string' ? snapshot.message : undefined
  };
}

function readUpdateError(value: unknown, status: number): string {
  if (typeof value === 'object' && value !== null && typeof (value as { error?: unknown }).error === 'string') {
    return (value as { error: string }).error;
  }

  return `桌面更新服务请求失败：HTTP ${status}`;
}

async function postUpdateSnapshot(
  endpoint: string,
  locationLike: Pick<Location, 'protocol'> | undefined,
  fetchImpl: FetchLike
): Promise<UpdateSnapshot> {
  const response = await fetchImpl(resolveRendererFallbackEndpoint(endpoint, locationLike), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  return readUpdateJson(response);
}

export async function getUpdateState(
  locationLike: Pick<Location, 'protocol'> | undefined = typeof window !== 'undefined' ? window.location : undefined,
  fetchImpl: FetchLike = fetch
): Promise<UpdateSnapshot> {
  if (window.asmAgent?.getUpdateState) {
    return window.asmAgent.getUpdateState();
  }

  if (isDesktopFallbackLocation(locationLike)) {
    return postUpdateSnapshot(UPDATE_STATE_ENDPOINT, locationLike, fetchImpl);
  }

  return buildUnsupportedSnapshot();
}

export async function checkForUpdates(
  locationLike: Pick<Location, 'protocol'> | undefined = typeof window !== 'undefined' ? window.location : undefined,
  fetchImpl: FetchLike = fetch
): Promise<UpdateSnapshot> {
  if (window.asmAgent?.checkForUpdates) {
    return window.asmAgent.checkForUpdates();
  }

  if (isDesktopFallbackLocation(locationLike)) {
    return postUpdateSnapshot(UPDATE_CHECK_ENDPOINT, locationLike, fetchImpl);
  }

  return buildUnsupportedSnapshot();
}

export function onUpdateStateChange(
  listener: (snapshot: UpdateSnapshot) => void,
  locationLike: Pick<Location, 'protocol'> | undefined = typeof window !== 'undefined' ? window.location : undefined,
  fetchImpl: FetchLike = fetch
): () => void {
  if (window.asmAgent?.onUpdateStateChange) {
    return window.asmAgent.onUpdateStateChange(listener);
  }

  if (!isDesktopFallbackLocation(locationLike)) {
    return () => undefined;
  }

  let disposed = false;
  let lastSnapshotJson = '';
  const poll = async () => {
    if (disposed) return;

    try {
      const snapshot = await postUpdateSnapshot(UPDATE_STATE_ENDPOINT, locationLike, fetchImpl);
      const snapshotJson = JSON.stringify(snapshot);
      if (snapshotJson !== lastSnapshotJson) {
        lastSnapshotJson = snapshotJson;
        listener(snapshot);
      }
    } catch {
      // polling failures should not crash the renderer; a later poll may recover.
    }
  };

  void poll();
  const timer = window.setInterval(() => {
    void poll();
  }, UPDATE_POLL_INTERVAL_MS);

  return () => {
    disposed = true;
    window.clearInterval(timer);
  };
}

export async function quitAndInstallUpdate(
  locationLike: Pick<Location, 'protocol'> | undefined = typeof window !== 'undefined' ? window.location : undefined,
  fetchImpl: FetchLike = fetch
): Promise<void> {
  if (window.asmAgent?.quitAndInstallUpdate) {
    await window.asmAgent.quitAndInstallUpdate();
    return;
  }

  if (!isDesktopFallbackLocation(locationLike)) {
    return;
  }

  const response = await fetchImpl(resolveRendererFallbackEndpoint(UPDATE_QUIT_AND_INSTALL_ENDPOINT, locationLike), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const text = await response.text();
    const payload = text.trim() ? JSON.parse(text) as unknown : {};
    throw new Error(readUpdateError(payload, response.status));
  }
}
