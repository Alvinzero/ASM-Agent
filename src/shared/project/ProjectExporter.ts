import fs from 'node:fs';
import path from 'node:path';
import type { GeneratedProject } from './ProjectTypes';

function hasUnsafeSegment(relativePath: string): boolean {
  return relativePath.split(/[\\/]+/).some((segment) => segment === '..');
}

function isDriveRootedPath(relativePath: string): boolean {
  return /^[a-zA-Z]:/.test(relativePath);
}

function isOutsideBaseDir(relativeTarget: string): boolean {
  return relativeTarget === '..' || relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget);
}

function assertSafeExportRootPath(rootDir: string): void {
  if (rootDir.trim().length === 0 || (!path.isAbsolute(rootDir) && !path.win32.isAbsolute(rootDir))) {
    throw new Error(`Unsafe export root path: ${rootDir}`);
  }
}

function assertSafeRelativePath(relativePath: string, baseDir: string, label: string): void {
  if (
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    isDriveRootedPath(relativePath) ||
    hasUnsafeSegment(relativePath)
  ) {
    throw new Error(`Unsafe ${label} path: ${relativePath}`);
  }

  const target = path.resolve(baseDir, relativePath);
  const relativeTarget = path.relative(baseDir, target);

  if (relativeTarget.length === 0 || isOutsideBaseDir(relativeTarget)) {
    throw new Error(`Unsafe ${label} path: ${relativePath}`);
  }
}

export function exportProject(rootDir: string, project: GeneratedProject): string {
  assertSafeExportRootPath(rootDir);
  assertSafeRelativePath(project.projectName, rootDir, 'project');

  const projectDir = path.join(rootDir, project.projectName);
  fs.mkdirSync(projectDir, { recursive: true });

  for (const generatedFile of project.files) {
    assertSafeRelativePath(generatedFile.path, projectDir, 'generated file');
    const target = path.join(projectDir, generatedFile.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, generatedFile.content, 'utf8');
  }

  return projectDir;
}
