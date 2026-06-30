import { describe, expect, it, vi } from 'vitest';

import { openSessionFileViaLocalProxy, saveAsmFileViaLocalProxy } from '../../src/renderer/state/SessionFileProxy';

describe('session file proxy', () => {
  it('routes desktop fallback file saves through the local protocol when running from file://', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          path: 'main.asm',
          absolutePath: 'C:\\ASM Agent\\sessions\\session-1\\main.asm',
          sessionDir: 'C:\\ASM Agent\\sessions\\session-1'
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );
    });

    await expect(
      saveAsmFileViaLocalProxy(
        {
          sessionId: 'session-1',
          file: {
            path: 'main.asm',
            content: 'CLRWDT\n'
          }
        },
        fetchMock,
        { protocol: 'file:' } as Location
      )
    ).resolves.toMatchObject({
      path: 'main.asm'
    });

    expect(fetchMock).toHaveBeenCalledWith('asm-agent://local/api/session-file/save', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sessionId: 'session-1',
        file: {
          path: 'main.asm',
          content: 'CLRWDT\n'
        }
      })
    });
  });

  it('routes desktop fallback folder reveal through the local protocol when running from file://', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    });

    await expect(
      openSessionFileViaLocalProxy(
        { path: 'C:\\ASM Agent\\sessions\\session-1\\main.asm' },
        fetchMock,
        { protocol: 'file:' } as Location
      )
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith('asm-agent://local/api/session-file/open', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ path: 'C:\\ASM Agent\\sessions\\session-1\\main.asm' })
    });
  });
});
