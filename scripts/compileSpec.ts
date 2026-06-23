import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { DEFAULT_DOCUMENT_SOURCE, compileSpec, type SpecSourceRow } from '../src/shared/spec/SpecCompiler';

function readSheetRows(file: string): SpecSourceRow[] {
  const workbook = XLSX.readFile(file);
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(firstSheet, { defval: '' }) as SpecSourceRow[];
}

function registerRowsWithNotes(rows: SpecSourceRow[]) {
  const result: Array<{ row: SpecSourceRow; notes: string[] }> = [];
  let current: { row: SpecSourceRow; notes: string[] } | undefined;

  for (const row of rows) {
    if (row.name || row.address || row.kind || row.reset_value || row.resetValue) {
      current = { row, notes: [] };
      result.push(current);
      continue;
    }

    const note = Object.values(row)
      .map((value) => String(value).trim())
      .find((value) => value.length > 0);
    if (current && note) current.notes.push(note);
  }

  return result;
}

function asciiJson(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(/[\u007f-\uffff]/g, (char) => {
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });
}

const [, , instructionFile, registerFile] = process.argv;

if (!instructionFile || !registerFile) {
  console.error('Usage: npm run spec:compile -- <instruction.xlsx> <register.xlsx>');
  process.exit(1);
}

const outputFile = path.resolve('src/shared/spec/hk8s8100x.v0.1.json');

const spec = compileSpec({
  instructionRows: readSheetRows(instructionFile),
  registerRows: registerRowsWithNotes(readSheetRows(registerFile)),
  instructionSource: path.basename(instructionFile),
  registerSource: path.basename(registerFile),
  documentSource: DEFAULT_DOCUMENT_SOURCE
});

fs.writeFileSync(outputFile, `${asciiJson(spec)}\n`, 'utf8');
console.log(`Wrote ${outputFile}`);
console.log(`Instructions: ${spec.instructions.length}`);
console.log(`Registers: ${spec.registers.length}`);
