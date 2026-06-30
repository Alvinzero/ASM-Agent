import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/renderer/App';

describe('update settings', () => {
  beforeEach(() => {
    window.localStorage.clear();
    const asmAgent = {
      version: '0.0.1',
      createPlan: vi.fn(),
      generateProject: vi.fn(),
      getCurrentUser: vi.fn().mockResolvedValue({
        account: 'admin',
        name: 'Admin',
        role: 'ASM 工程师'
      }),
      loginUser: vi.fn(),
      registerUser: vi.fn(),
      logoutUser: vi.fn(),
      checkForUpdates: vi.fn().mockResolvedValue({
        status: 'checking',
        version: '0.0.1'
      }),
      getUpdateState: vi.fn().mockResolvedValue({
        status: 'idle',
        version: '0.0.1'
      }),
      onUpdateStateChange: vi.fn(() => () => undefined),
      quitAndInstallUpdate: vi.fn()
    };

    vi.stubGlobal('asmAgent', asmAgent);
    Object.defineProperty(window, 'asmAgent', {
      configurable: true,
      value: asmAgent
    });
  });

  it('shows update actions in settings and triggers a manual check', async () => {
    render(<App />);
    await screen.findByLabelText('ASM Agent 导航');

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    const dialog = screen.getByRole('dialog', { name: '设置' });
    fireEvent.click(within(dialog).getByRole('button', { name: '关于' }));

    expect(within(dialog).getByRole('button', { name: '检查更新' })).toBeInTheDocument();
    expect(within(dialog).getByText('更新状态')).toBeInTheDocument();
    expect(within(dialog).getByText('尚未检查更新')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '检查更新' }));

    await waitFor(() => expect(window.asmAgent?.checkForUpdates).toHaveBeenCalledTimes(1));
  });
});
