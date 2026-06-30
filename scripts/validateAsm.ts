import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  assertAsmSourcePassesQualityGate,
  formatAsmDiagnosticForUser,
  validateAsmSourceQuality
} from '../src/shared/asm/AsmQualityGate';
import type { AsmDiagnostic } from '../src/shared/asm/AsmValidator';
import { BuiltInSpecRepository } from '../src/shared/spec/BuiltInSpecRepository';

export function resolveAsmFileArgument(argv = process.argv.slice(2)): string | undefined {
  return argv.filter((argument) => argument !== '--')[0];
}

export function validateAsmFile(asmFile: string): void {
  const resolvedFile = path.resolve(asmFile);
  const source = fs.readFileSync(resolvedFile, 'utf8');
  const spec = new BuiltInSpecRepository().getByChipId('HK64S8x');
  const diagnostics = validateAsmSourceQuality(source, spec);

  if (diagnostics.length > 0) {
    for (const diagnostic of diagnostics) {
      console.error(formatAsmFileDiagnostic(resolvedFile, diagnostic));
    }
    assertAsmSourcePassesQualityGate(source, spec);
  }

  console.log(`ASM 质量闸通过：${resolvedFile}`);
  console.log(`规范：${spec.chipId} v${spec.version}`);
}

export function formatAsmFileDiagnostic(file: string, diagnostic: AsmDiagnostic): string {
  return `${file}：${formatAsmDiagnosticForUser(diagnostic)}`;
}

function main(): void {
  const asmFile = resolveAsmFileArgument();

  if (!asmFile) {
    console.error('用法：npm run asm:validate -- <file.asm>');
    process.exit(1);
  }

  validateAsmFile(asmFile);
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === pathToFileURL(entry).href);
}

if (isMainModule()) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
