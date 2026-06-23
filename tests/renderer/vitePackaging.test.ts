import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Vite packaging config', () => {
  it('uses relative asset URLs for packaged Electron file loading', () => {
    const config = fs.readFileSync(path.join(process.cwd(), 'vite.config.ts'), 'utf8');

    expect(config).toContain("base: './'");
  });
});
