import fs from 'node:fs';
import path from 'node:path';

import type { GeneratedFile } from './ProjectTypes';

export interface SavedAsmFile {
  path: string;
  absolutePath: string;
  sessionDir: string;
}

export function getDefaultSessionOutputRoot(baseDir = process.cwd()): string {
  return path.resolve(baseDir, 'output', 'sessions');
}

export function saveSessionAsmFile(rootDir: string, sessionId: string, file: GeneratedFile): SavedAsmFile {
  assertSafeRootPath(rootDir);
  assertSafeSessionAsmFilePath(file.path);

  const safeSessionId = sanitizeSessionId(sessionId);
  const sessionDir = path.join(rootDir, safeSessionId);
  const absolutePath = path.join(sessionDir, file.path);

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(absolutePath, file.content, 'utf8');

  return {
    path: file.path,
    absolutePath,
    sessionDir
  };
}

export function assertPathInsideRoot(rootDir: string, targetPath: string, label: string): void {
  assertSafeRootPath(rootDir);

  if (!path.isAbsolute(targetPath) && !path.win32.isAbsolute(targetPath)) {
    throw new Error(`Unsafe ${label} path: ${targetPath}`);
  }

  const resolvedRoot = path.resolve(rootDir);
  const resolvedTarget = path.resolve(targetPath);
  const relativeTarget = path.relative(resolvedRoot, resolvedTarget);

  if (
    relativeTarget.length === 0 ||
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeTarget)
  ) {
    throw new Error(`Unsafe ${label} path: ${targetPath}`);
  }
}

function assertSafeRootPath(rootDir: string): void {
  if (rootDir.trim().length === 0 || (!path.isAbsolute(rootDir) && !path.win32.isAbsolute(rootDir))) {
    throw new Error(`Unsafe session output root path: ${rootDir}`);
  }
}

function assertSafeSessionAsmFilePath(filePath: string): void {
  if (
    filePath.length === 0 ||
    filePath.includes('/') ||
    filePath.includes('\\') ||
    path.isAbsolute(filePath) ||
    path.win32.isAbsolute(filePath) ||
    /^[a-zA-Z]:/.test(filePath) ||
    !filePath.toLowerCase().endsWith('.asm')
  ) {
    throw new Error(`Unsafe session ASM file path: ${filePath}`);
  }
}

function sanitizeSessionId(sessionId: string): string {
  const normalized = sessionId
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);

  return normalized || 'session';
}
