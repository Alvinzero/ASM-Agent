import { EventEmitter } from 'node:events';
import type { ProgressInfo, UpdateInfo } from 'electron-updater';

import type { UpdateSnapshot } from '../../shared/updater/UpdateSnapshot';

export interface AppUpdaterAdapter extends EventEmitter {
  autoDownload: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

interface AppUpdaterOptions {
  adapter: AppUpdaterAdapter;
  currentVersion: string;
  isPackaged: boolean;
  onStateChange?: (snapshot: UpdateSnapshot) => void;
}

export class AppUpdater {
  private readonly adapter: AppUpdaterAdapter;
  private readonly currentVersion: string;
  private readonly isPackaged: boolean;
  private readonly onStateChange?: (snapshot: UpdateSnapshot) => void;
  private snapshot: UpdateSnapshot;

  constructor(options: AppUpdaterOptions) {
    this.adapter = options.adapter;
    this.currentVersion = options.currentVersion;
    this.isPackaged = options.isPackaged;
    this.onStateChange = options.onStateChange;
    this.snapshot = {
      status: 'idle',
      version: this.currentVersion
    };

    this.adapter.autoDownload = true;
    this.bindEvents();
  }

  getSnapshot(): UpdateSnapshot {
    return this.snapshot;
  }

  async checkForUpdates(): Promise<UpdateSnapshot> {
    if (!this.isPackaged) {
      return this.setSnapshot({
        status: 'unsupported',
        version: this.currentVersion,
        message: '自动更新仅在安装版应用中可用，请使用 Windows 安装包进行验证。'
      });
    }

    this.setSnapshot({
      status: 'checking',
      version: this.currentVersion
    });

    try {
      await this.adapter.checkForUpdates();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : '检查更新失败';
      return this.setSnapshot({
        status: 'error',
        version: this.currentVersion,
        message
      });
    }

    return this.snapshot;
  }

  quitAndInstall(): void {
    this.adapter.quitAndInstall();
  }

  private bindEvents(): void {
    this.adapter.on('checking-for-update', () => {
      this.setSnapshot({
        status: 'checking',
        version: this.currentVersion
      });
    });

    this.adapter.on('update-available', (info: UpdateInfo) => {
      this.setSnapshot({
        status: 'available',
        version: this.currentVersion,
        availableVersion: info.version
      });
    });

    this.adapter.on('update-not-available', () => {
      this.setSnapshot({
        status: 'not-available',
        version: this.currentVersion,
        message: '当前已经是最新版本。'
      });
    });

    this.adapter.on('download-progress', (progress: ProgressInfo) => {
      this.setSnapshot({
        status: 'downloading',
        version: this.currentVersion,
        availableVersion: this.snapshot.availableVersion,
        progressPercent: Math.max(0, Math.min(100, Math.round(progress.percent))),
        transferredBytes: progress.transferred,
        totalBytes: progress.total
      });
    });

    this.adapter.on('update-downloaded', (info: { version: string }) => {
      this.setSnapshot({
        status: 'downloaded',
        version: this.currentVersion,
        availableVersion: info.version,
        message: '新版本已下载完成，重启应用后即可安装。'
      });
    });

    this.adapter.on('error', (caught: Error) => {
      this.setSnapshot({
        status: 'error',
        version: this.currentVersion,
        availableVersion: this.snapshot.availableVersion,
        message: caught?.message || '更新服务异常'
      });
    });
  }

  private setSnapshot(snapshot: UpdateSnapshot): UpdateSnapshot {
    this.snapshot = snapshot;
    this.onStateChange?.(snapshot);
    return snapshot;
  }
}
