import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('release workflow', () => {
  it('creates a single GitHub release explicitly before uploading Windows artifacts', () => {
    const workflow = readFileSync(resolve('.github/workflows/release.yml'), 'utf8');

    expect(workflow).toContain('gh release view "$env:RELEASE_TAG"');
    expect(workflow).toContain('gh release create "$env:RELEASE_TAG"');
    expect(workflow).toContain('Get-ChildItem release');
    expect(workflow).toContain('foreach ($artifact in $artifacts)');
    expect(workflow).toContain('gh release upload "$env:RELEASE_TAG" $artifact');
  });

  it('builds release artifacts without delegating GitHub publishing to electron-builder', () => {
    const packageJson = readFileSync(resolve('package.json'), 'utf8');

    expect(packageJson).toContain('"release:win": "npm run build && electron-builder --win nsis"');
    expect(packageJson).not.toContain('--publish always');
  });

  it('uses an explicit Windows installer artifact name that matches the upload step', () => {
    const builderConfig = readFileSync(resolve('electron-builder.yml'), 'utf8');

    expect(builderConfig).toContain('artifactName: ASM-Agent-Setup-${version}.${ext}');
  });
});
