import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProjectOutputPanel } from '../../src/renderer/components/ProjectOutputPanel';
import type { AgentSessionState } from '../../src/renderer/state/useAgentSession';

function createSession(): AgentSessionState {
  const asmFile = {
    path: 'main.asm',
    absolutePath: 'C:\\ASM Agent Sessions\\test-session\\main.asm',
    sessionDir: 'C:\\ASM Agent Sessions\\test-session',
    content: 'RET\n',
    sizeLabel: '4 B',
    lineCount: 1,
    generatedAt: Date.now()
  };

  return {
    sessionId: 'test-session',
    chipId: 'HK64S8x',
    apiVersion: '0.1.0',
    isBridgeReady: true,
    requirement: '',
    plan: null,
    project: null,
    asmFile,
    canGenerateProject: false,
    pendingNormalizationRequirement: null,
    normalizationStatus: 'validated',
    canNormalizeAsm: false,
    messages: [],
    loading: 'idle',
    error: null,
    setRequirement: vi.fn(),
    createPlan: vi.fn(async () => undefined),
    cancelCurrentRun: vi.fn(),
    generateProject: vi.fn(async () => undefined),
    normalizeAsm: vi.fn(async () => undefined),
    openAsmFile: vi.fn(async () => undefined),
    resetSession: vi.fn(),
    createSnapshot: vi.fn(() => ({
      sessionId: 'test-session',
      requirement: '',
      plannedRequirement: null,
      pendingNormalizationRequirement: null,
      normalizationStatus: 'validated' as const,
      plan: null,
      project: null,
      asmFile,
      messages: [],
      loading: 'idle' as const,
      error: null
    })),
    restoreSnapshot: vi.fn()
  };
}

describe('ProjectOutputPanel', () => {
  it('renders a simple inline external-link glyph in the open file button', () => {
    render(<ProjectOutputPanel session={createSession()} />);

    const openButton = screen.getByRole('button', { name: '打开文件所在位置' });
    const icon = openButton.querySelector('.output-open-icon');
    const svg = icon?.querySelector('svg');

    expect(icon?.querySelector('img')).not.toBeInTheDocument();
    expect(svg).toBeInTheDocument();
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg?.querySelectorAll('path')).toHaveLength(2);
  });

  it('opens the saved file location from the output button', () => {
    const session = createSession();
    render(<ProjectOutputPanel session={session} />);

    fireEvent.click(screen.getByRole('button', { name: '打开文件所在位置' }));

    expect(session.openAsmFile).toHaveBeenCalledTimes(1);
  });
});
