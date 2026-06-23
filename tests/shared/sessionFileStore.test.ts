import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { saveSessionAsmFile } from '../../src/shared/project/SessionFileStore';

describe('SessionFileStore', () => {
  const tempRoots: string[] = [];

  function makeTempRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asm-agent-sessions-'));
    tempRoots.push(root);
    return root;
  }

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes generated main.asm into the current session folder root', () => {
    const root = makeTempRoot();

    const saved = saveSessionAsmFile(root, 'session-123', {
      path: 'main.asm',
      content: 'CLRWDT\n'
    });

    expect(saved.sessionDir).toBe(path.join(root, 'session-123'));
    expect(saved.absolutePath).toBe(path.join(root, 'session-123', 'main.asm'));
    expect(saved.path).toBe('main.asm');
    expect(fs.readFileSync(path.join(root, 'session-123', 'main.asm'), 'utf8')).toBe('CLRWDT\n');
    expect(fs.existsSync(path.join(root, 'session-123', 'src', 'main.asm'))).toBe(false);
  });

  it.each([['src/main.asm'], ['../main.asm'], ['C:\\tmp\\main.asm'], ['']])(
    'rejects paths that would escape the session root: %s',
    (unsafePath) => {
      expect(() =>
        saveSessionAsmFile(makeTempRoot(), 'session-123', {
          path: unsafePath,
          content: 'CLRWDT\n'
        })
      ).toThrow(`Unsafe session ASM file path: ${unsafePath}`);
    }
  );
});
