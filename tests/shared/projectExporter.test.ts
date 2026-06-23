import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { exportProject } from '../../src/shared/project/ProjectExporter';

describe('ProjectExporter', () => {
  const tempRoots: string[] = [];

  function makeTempRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asm-agent-'));
    tempRoots.push(root);
    return root;
  }

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes generated files to a project directory', () => {
    const root = makeTempRoot();

    exportProject(root, {
      projectName: 'demo',
      files: [
        { path: 'src/main.asm', content: 'CLRWDT\n' },
        { path: 'docs/readme..bak', content: 'notes\n' }
      ]
    });

    expect(fs.readFileSync(path.join(root, 'demo/src/main.asm'), 'utf8')).toBe('CLRWDT\n');
    expect(fs.readFileSync(path.join(root, 'demo/docs/readme..bak'), 'utf8')).toBe('notes\n');
  });

  it.each([
    ['../demo'],
    ['src/../demo'],
    ['/tmp/demo'],
    ['C:\\tmp\\demo'],
    ['C:tmp\\demo']
  ])('rejects unsafe project name %s', (projectName) => {
    const root = makeTempRoot();

    expect(() =>
      exportProject(root, {
        projectName,
        files: [{ path: 'src/main.asm', content: 'CLRWDT\n' }]
      })
    ).toThrow(`Unsafe project path: ${projectName}`);
  });

  it.each([[''], ['relative-root']])('rejects unsafe export root path %s', (rootDir) => {
    expect(() =>
      exportProject(rootDir, {
        projectName: 'demo',
        files: [{ path: 'src/main.asm', content: 'CLRWDT\n' }]
      })
    ).toThrow(`Unsafe export root path: ${rootDir}`);
  });

  it.each([
    [''],
    ['../main.asm'],
    ['src/../main.asm'],
    ['/tmp/main.asm'],
    ['C:\\tmp\\main.asm'],
    ['C:tmp\\main.asm']
  ])('rejects unsafe generated file path %s', (unsafePath) => {
    const root = makeTempRoot();

    expect(() =>
      exportProject(root, {
        projectName: 'demo',
        files: [{ path: unsafePath, content: 'CLRWDT\n' }]
      })
    ).toThrow(`Unsafe generated file path: ${unsafePath}`);
  });
});
