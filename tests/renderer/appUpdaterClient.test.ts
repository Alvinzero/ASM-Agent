import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('app updater client', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, 'asmAgent', {
      configurable: true,
      value: undefined
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('routes desktop fallback update state checks through the local protocol when running from file://', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ status: 'idle', version: '0.0.5' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getUpdateState } = await import('../../src/renderer/state/AppUpdaterClient');

    await expect(getUpdateState({ protocol: 'file:' } as Location, fetchMock)).resolves.toMatchObject({
      status: 'idle',
      version: '0.0.5'
    });
    expect(fetchMock).toHaveBeenCalledWith('asm-agent://local/api/updater/state', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
  });

  it('routes desktop fallback manual update checks through the local protocol when running from file://', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ status: 'checking', version: '0.0.5' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { checkForUpdates } = await import('../../src/renderer/state/AppUpdaterClient');

    await expect(checkForUpdates({ protocol: 'file:' } as Location, fetchMock)).resolves.toMatchObject({
      status: 'checking',
      version: '0.0.5'
    });
    expect(fetchMock).toHaveBeenCalledWith('asm-agent://local/api/updater/check', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
  });

  it('routes desktop fallback update downloads through the local protocol when running from file://', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ status: 'downloading', version: '0.0.5', availableVersion: '0.0.6' }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { downloadUpdate } = await import('../../src/renderer/state/AppUpdaterClient');

    await expect(downloadUpdate({ protocol: 'file:' } as Location, fetchMock)).resolves.toMatchObject({
      status: 'downloading',
      version: '0.0.5',
      availableVersion: '0.0.6'
    });
    expect(fetchMock).toHaveBeenCalledWith('asm-agent://local/api/updater/download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
  });

  it('polls desktop fallback update state changes when the preload bridge is unavailable', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'idle', version: '0.0.5' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ status: 'downloaded', version: '0.0.5', availableVersion: '0.0.6' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    const { onUpdateStateChange } = await import('../../src/renderer/state/AppUpdaterClient');
    const listener = vi.fn();

    const dispose = onUpdateStateChange(listener, { protocol: 'file:' } as Location, fetchMock);
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1500);
    await Promise.resolve();

    expect(listener).toHaveBeenCalledWith({
      status: 'downloaded',
      version: '0.0.5',
      availableVersion: '0.0.6'
    });

    dispose();
  });
});
