import fs from 'node:fs';
import { validateAsmSourceQuality, formatAsmDiagnosticForUser } from './src/shared/asm/AsmQualityGate';
import { BuiltInSpecRepository } from './src/shared/spec/BuiltInSpecRepository';

const file = process.argv[2];
const source = fs.readFileSync(file, 'utf8');
const spec = new BuiltInSpecRepository().getByChipId('HK64S8x');
const diags = validateAsmSourceQuality(source, spec);
if (diags.length === 0) {
  console.log('PASS: 质量闸通过 ' + spec.chipId + ' v' + spec.version);
} else {
  console.log('FAIL: ' + diags.length + ' 个问题');
  for (const d of diags) console.log('  - ' + formatAsmDiagnosticForUser(d));
}
