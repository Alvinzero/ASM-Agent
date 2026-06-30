import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { AppUpdater, type AppUpdaterAdapter } from '../../src/main/updater/AppUpdater';
import type { UpdateSnapshot } from '../../src/shared/updater/UpdateSnapshot';

class FakeUpdater extends EventEmitter implements AppUpdaterAdapter {
  autoDownload = true;
  checkForUpdates = vi.fn(async () => undefined);
  downloadUpdate = vi.fn(async () => undefined);
  quitAndInstall = vi.fn();
}

function createService(options?: { isPackaged?: boolean }) {
  const adapter = new FakeUpdater();
  const updates: UpdateSnapshot[] = [];
  const service = new AppUpdater({
    adapter,
    currentVersion: '0.0.1',
    isPackaged: options?.isPackaged ?? true,
    onStateChange: (snapshot) => {
      updates.push(snapshot);
    }
  });

  return { adapter, service, updates };
}

describe('AppUpdater', () => {
  it('tracks checking, available, downloading and downloaded states', async () => {
    const { adapter, service } = createService();

    await service.checkForUpdates();
    expect(adapter.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot()).toMatchObject({
      status: 'checking',
      version: '0.0.1'
    });

    adapter.emit('update-available', { version: '0.0.2' });
    expect(service.getSnapshot()).toMatchObject({
      status: 'available',
      availableVersion: '0.0.2'
    });

    adapter.emit('download-progress', { percent: 42.4, transferred: 10, total: 20 });
    expect(service.getSnapshot()).toMatchObject({
      status: 'downloading',
      availableVersion: '0.0.2',
      progressPercent: 42
    });

    adapter.emit('update-downloaded', { version: '0.0.2' });
    expect(service.getSnapshot()).toMatchObject({
      status: 'downloaded',
      availableVersion: '0.0.2'
    });
  });

  it('reports unsupported checks in unpackaged development mode', async () => {
    const { adapter, service, updates } = createService({ isPackaged: false });

    const snapshot = await service.checkForUpdates();

    expect(adapter.checkForUpdates).not.toHaveBeenCalled();
    expect(snapshot).toMatchObject({
      status: 'unsupported',
      message: expect.stringContaining('安装版')
    });
    expect(updates.at(-1)).toMatchObject({
      status: 'unsupported'
    });
  });

  it('surfaces updater errors and keeps quitAndInstall wired', () => {
    const { adapter, service } = createService();

    adapter.emit('error', new Error('network timeout'));
    expect(service.getSnapshot()).toMatchObject({
      status: 'error',
      message: 'network timeout'
    });

    service.quitAndInstall();
    expect(adapter.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it('starts downloading after a new version is discovered', async () => {
    const { adapter, service } = createService();

    adapter.emit('update-available', { version: '0.0.8' });
    const snapshot = await service.downloadUpdate();

    expect(adapter.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(snapshot).toMatchObject({
      status: 'downloading',
      availableVersion: '0.0.8'
    });
  });
});
