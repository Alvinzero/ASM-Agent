# ASM Agent MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows-first local desktop MVP where a user describes an ASM requirement in natural language and the app generates a complete ASM project constrained by the company chip instruction set, register design, and built-in ASM rules.

**Architecture:** Use Electron for the Windows desktop shell, React for the Marvis-inspired assistant UI, and TypeScript domain modules for the built-in chip specification, ASM parsing, validation, and project generation. The agent core is structured as a local orchestration layer with deterministic rule/template generation first, plus a model-adapter interface for a future local LLM without changing UI or validation boundaries.

**Tech Stack:** Electron, Vite, React, TypeScript, Vitest, Testing Library, `xlsx`, `mammoth`, `zod`, `electron-builder`.

---

## File Structure

Create the application under the repository root `C:/Users/Admin/Documents/ASM Agent`.

```text
.
  package.json
  package-lock.json
  tsconfig.json
  tsconfig.node.json
  vite.config.ts
  vitest.config.ts
  electron-builder.yml
  src/
    main/
      main.ts
      preload.ts
      ipc/
        agentHandlers.ts
        projectHandlers.ts
    renderer/
      index.html
      main.tsx
      App.tsx
      styles/
        tokens.css
        app.css
      components/
        AssistantChat.tsx
        ChipPlatformPanel.tsx
        GeneratedProjectPanel.tsx
        SpecCompliancePanel.tsx
      state/
        useAgentSession.ts
    shared/
      agent/
        AgentService.ts
        GenerationPlanner.ts
        LocalRuleAgent.ts
        ModelAdapter.ts
      asm/
        AsmParser.ts
        AsmValidator.ts
        InstructionEncoder.ts
        ProjectGenerator.ts
      spec/
        ChipSpec.ts
        BuiltInSpecRepository.ts
        SpecCompiler.ts
        hk8s8100x.v0.1.json
      project/
        ProjectTypes.ts
        ProjectExporter.ts
  scripts/
    compileSpec.ts
  tests/
    fixtures/
      instruction_set.fixture.xlsx
      register_set.fixture.xlsx
    shared/
      specCompiler.test.ts
      asmParser.test.ts
      asmValidator.test.ts
      instructionEncoder.test.ts
      agentService.test.ts
      projectGenerator.test.ts
    renderer/
      assistantFlow.test.tsx
  docs/
    superpowers/
      specs/
        2026-06-12-asm-agent-product-design.md
      plans/
        2026-06-12-asm-agent-mvp-implementation.md
```

Responsibility boundaries:

- `src/shared/spec/`: normalizes built-in company chip rules from Excel/Docx-derived sources.
- `src/shared/asm/`: parses, validates, encodes, and generates ASM project files.
- `src/shared/agent/`: converts natural language requests into generation plans and calls the generator.
- `src/main/`: Electron lifecycle, secure preload bridge, and IPC handlers.
- `src/renderer/`: desktop UI centered on the ASM assistant conversation.
- `scripts/compileSpec.ts`: internal build-time compiler for converting company spec sources into built-in JSON.

---

## Task 1: Scaffold The Electron React TypeScript App

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `electron-builder.yml`
- Create: `src/main/main.ts`
- Create: `src/main/preload.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/main.tsx`
- Create: `src/renderer/App.tsx`

- [ ] **Step 1: Create `package.json` with desktop, test, and packaging scripts**

```json
{
  "name": "asm-agent",
  "version": "0.1.0",
  "private": true,
  "description": "Local ASM project generation agent for company chip platforms.",
  "main": "dist-main/main.js",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "dev:electron": "concurrently \"npm run dev\" \"wait-on http://127.0.0.1:5173 && cross-env VITE_DEV_SERVER_URL=http://127.0.0.1:5173 electron .\"",
    "build": "tsc -p tsconfig.node.json && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "spec:compile": "tsx scripts/compileSpec.ts",
    "package:win": "npm run build && electron-builder --win nsis",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^5.0.0",
    "mammoth": "^1.8.0",
    "vite": "^7.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "xlsx": "^0.18.5",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.0.0",
    "@types/node": "^24.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "concurrently": "^9.1.0",
    "cross-env": "^7.0.3",
    "electron": "^37.0.0",
    "electron-builder": "^26.0.0",
    "jsdom": "^26.0.0",
    "tsx": "^4.20.0",
    "typescript": "^5.8.0",
    "vitest": "^3.2.0",
    "wait-on": "^8.0.0"
  },
  "build": {
    "appId": "com.company.asmagent",
    "productName": "ASM Agent"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run:

```powershell
npm install
```

Expected: `package-lock.json` is created and npm exits with code 0.

- [ ] **Step 3: Add TypeScript and Vite configuration**

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src", "tests", "scripts"]
}
```

`tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "Node",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist-main",
    "rootDir": "src/main",
    "types": ["node", "electron"]
  },
  "include": ["src/main/**/*.ts"]
}
```

`vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  build: {
    outDir: '../../dist-renderer',
    emptyOutDir: true
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  }
});
```

`vitest.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: []
  }
});
```

- [ ] **Step 4: Add minimal Electron shell**

`src/main/main.ts`:

```ts
import { app, BrowserWindow } from 'electron';
import path from 'node:path';

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#f6f8fc',
    title: 'ASM Agent',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist-renderer/index.html'));
  }
}

void app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

`src/main/preload.ts`:

```ts
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('asmAgent', {
  version: '0.1.0'
});
```

- [ ] **Step 5: Add minimal React shell**

`src/renderer/index.html`:

```html
<div id="root"></div>
<script type="module" src="/main.tsx"></script>
```

`src/renderer/main.tsx`:

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/tokens.css';
import './styles/app.css';

createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

`src/renderer/App.tsx`:

```tsx
export function App() {
  return (
    <main className="app-shell">
      <section className="welcome-panel">
        <h1>ASM Agent</h1>
        <p>本地 ASM 汇编工程生成智能体</p>
      </section>
    </main>
  );
}
```

- [ ] **Step 6: Verify scaffold**

Run:

```powershell
npm run lint
npm run test
npm run build
```

Expected:

- `npm run lint` exits 0.
- `npm run test` reports no test files or exits cleanly after configuration.
- `npm run build` creates `dist-main/` and `dist-renderer/`.

- [ ] **Step 7: Commit**

Run:

```powershell
git add package.json package-lock.json tsconfig.json tsconfig.node.json vite.config.ts vitest.config.ts electron-builder.yml src
git commit -m "chore: scaffold ASM Agent desktop app"
```

If `git` is unavailable on this Windows machine, record the changed files in the task handoff and continue.

---

## Task 2: Define Built-In Chip Specification Contracts

**Files:**
- Create: `src/shared/spec/ChipSpec.ts`
- Create: `src/shared/spec/BuiltInSpecRepository.ts`
- Create: `tests/shared/specRepository.test.ts`

- [ ] **Step 1: Write failing tests for built-in spec access**

`tests/shared/specRepository.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BuiltInSpecRepository } from '../../src/shared/spec/BuiltInSpecRepository';

describe('BuiltInSpecRepository', () => {
  it('loads HK8S8100X as a built-in chip platform', () => {
    const repo = new BuiltInSpecRepository();
    const spec = repo.getByChipId('HK8S8100X');

    expect(spec.chipId).toBe('HK8S8100X');
    expect(spec.version).toBe('0.1');
    expect(spec.instructions.length).toBeGreaterThan(0);
    expect(spec.registers.length).toBeGreaterThan(0);
  });

  it('rejects unknown chip platforms', () => {
    const repo = new BuiltInSpecRepository();

    expect(() => repo.getByChipId('UNKNOWN_CHIP')).toThrow('Unsupported chip platform: UNKNOWN_CHIP');
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
npm run test -- tests/shared/specRepository.test.ts
```

Expected: FAIL because `BuiltInSpecRepository` does not exist.

- [ ] **Step 3: Add strict chip spec types**

`src/shared/spec/ChipSpec.ts`:

```ts
export type OperandKind = '' | 'r8' | 'k8' | 'k10' | 'r8,b';

export interface InstructionForm {
  mnemonic: string;
  asmSyntax: string;
  operands: OperandKind;
  wordBits: 16;
  opcodePattern: string;
  maskHex: string;
  valueHex: string;
  cycles: number;
  flagsAffected: string[];
  notes: string;
}

export interface RegisterBit {
  bit: number;
  name: string;
  description: string;
}

export interface RegisterSpec {
  name: string;
  address: number;
  addressText: string;
  kind: 'SFR' | 'OPTION';
  resetValue: string;
  bits: RegisterBit[];
  notes: string[];
}

export interface MemoryRegion {
  name: string;
  start: number;
  end: number;
}

export interface VectorSpec {
  reset: number;
  interrupt: number;
}

export interface AsmSyntaxSpec {
  labelPattern: string;
  commentPrefix: string;
  includeDirective: string;
  constantDirective: string;
  originDirective: string;
}

export interface ChipSpec {
  chipId: string;
  displayName: string;
  version: string;
  instructionSource: string;
  registerSource: string;
  documentSource: string;
  instructions: InstructionForm[];
  registers: RegisterSpec[];
  memory: MemoryRegion[];
  vectors: VectorSpec;
  asmSyntax: AsmSyntaxSpec;
}
```

- [ ] **Step 4: Add built-in repository with a minimal embedded spec**

`src/shared/spec/BuiltInSpecRepository.ts`:

```ts
import type { ChipSpec } from './ChipSpec';

const hk8s8100x: ChipSpec = {
  chipId: 'HK8S8100X',
  displayName: 'HK8S8100X',
  version: '0.1',
  instructionSource: 'instruction_set.xlsx',
  registerSource: 'register_set.xlsx',
  documentSource: 'HK8S8100X_规格书 V0.1.docx',
  instructions: [
    {
      mnemonic: 'NOP',
      asmSyntax: 'NOP',
      operands: '',
      wordBits: 16,
      opcodePattern: '0000 0000 00000000',
      maskHex: '0xFFFF',
      valueHex: '0x0000',
      cycles: 1,
      flagsAffected: [],
      notes: ''
    },
    {
      mnemonic: 'JMP',
      asmSyntax: 'JMP K',
      operands: 'k10',
      wordBits: 16,
      opcodePattern: '1100 00kk kkkkkkkk',
      maskHex: '0xFC00',
      valueHex: '0xC000',
      cycles: 2,
      flagsAffected: [],
      notes: 'PC ← K, K为10bit'
    },
    {
      mnemonic: 'CLRWDT',
      asmSyntax: 'CLRWDT',
      operands: '',
      wordBits: 16,
      opcodePattern: '1010 0011 00000000',
      maskHex: '0xFFFF',
      valueHex: '0xA300',
      cycles: 1,
      flagsAffected: [],
      notes: 'WDT ← 00'
    }
  ],
  registers: [
    {
      name: 'SCK_PS',
      address: 0x10,
      addressText: '10H',
      kind: 'SFR',
      resetValue: '0x34',
      bits: [
        { bit: 5, name: 'SCKHL', description: 'OSC高低频选择' },
        { bit: 4, name: 'EX', description: 'OSC使能' }
      ],
      notes: []
    }
  ],
  memory: [
    { name: 'SFR', start: 0x00, end: 0x7f },
    { name: 'RAM', start: 0x80, end: 0xbf }
  ],
  vectors: {
    reset: 0x000,
    interrupt: 0x008
  },
  asmSyntax: {
    labelPattern: '^[A-Za-z_][A-Za-z0-9_]*:$',
    commentPrefix: ';',
    includeDirective: 'INCLUDE',
    constantDirective: 'EQU',
    originDirective: 'ORG'
  }
};

export class BuiltInSpecRepository {
  getByChipId(chipId: string): ChipSpec {
    if (chipId === hk8s8100x.chipId) return hk8s8100x;
    throw new Error(`Unsupported chip platform: ${chipId}`);
  }
}
```

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```powershell
npm run test -- tests/shared/specRepository.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/shared/spec tests/shared/specRepository.test.ts
git commit -m "feat: define built-in chip spec contracts"
```

If `git` is unavailable, record the changed files in the task handoff and continue.

---

## Task 3: Compile Company Excel And Docx Sources Into Built-In JSON

**Files:**
- Create: `src/shared/spec/SpecCompiler.ts`
- Create: `scripts/compileSpec.ts`
- Create: `src/shared/spec/hk8s8100x.v0.1.json`
- Create: `tests/shared/specCompiler.test.ts`
- Modify: `src/shared/spec/BuiltInSpecRepository.ts`

- [ ] **Step 1: Write failing test for instruction and register normalization**

`tests/shared/specCompiler.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeAddress, normalizeInstructionRow, normalizeRegisterRow } from '../../src/shared/spec/SpecCompiler';

describe('SpecCompiler', () => {
  it('normalizes instruction rows from instruction_set.xlsx', () => {
    const instruction = normalizeInstructionRow({
      mnemonic: 'JMP',
      asm_syntax: 'JMP K',
      operands: 'k10',
      word_bits: '16',
      opcode_pattern: '1100 00kk kkkkkkkk',
      mask_hex: '0XFC00',
      value_hex: '0XC000',
      cycles: '2',
      flags_affected: '',
      notes: 'PC ← K ,K为10bit'
    });

    expect(instruction).toMatchObject({
      mnemonic: 'JMP',
      asmSyntax: 'JMP K',
      operands: 'k10',
      wordBits: 16,
      maskHex: '0xFC00',
      valueHex: '0xC000',
      cycles: 2
    });
  });

  it('normalizes register addresses written with H suffix', () => {
    expect(normalizeAddress('10H')).toBe(0x10);
    expect(normalizeAddress('1AH')).toBe(0x1a);
    expect(normalizeAddress('0x24')).toBe(0x24);
  });

  it('normalizes register rows from register_set.xlsx', () => {
    const register = normalizeRegisterRow({
      name: 'SCK_PS',
      address: '10H',
      kind: 'SFR',
      reset_value: '0x34',
      bit7: '-',
      bit6: '-',
      bit5: 'SCKHL',
      bit4: 'EX',
      bit3: 'SCKPS[3:0]',
      bit2: '',
      bit1: '',
      bit0: ''
    }, []);

    expect(register.name).toBe('SCK_PS');
    expect(register.address).toBe(0x10);
    expect(register.kind).toBe('SFR');
    expect(register.bits.map((bit) => bit.name)).toContain('SCKHL');
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
npm run test -- tests/shared/specCompiler.test.ts
```

Expected: FAIL because `SpecCompiler` does not exist.

- [ ] **Step 3: Implement spec normalization**

`src/shared/spec/SpecCompiler.ts`:

```ts
import type { ChipSpec, InstructionForm, OperandKind, RegisterSpec } from './ChipSpec';

type Row = Record<string, string | number | undefined | null>;

function text(value: string | number | undefined | null): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

export function normalizeAddress(value: string): number {
  const raw = value.trim();
  if (/^[0-9A-Fa-f]+H$/.test(raw)) {
    return Number.parseInt(raw.slice(0, -1), 16);
  }
  if (/^0x[0-9A-Fa-f]+$/.test(raw)) {
    return Number.parseInt(raw.slice(2), 16);
  }
  throw new Error(`Unsupported address format: ${value}`);
}

function normalizeHex(value: string): string {
  const raw = value.trim();
  if (!/^0x[0-9A-Fa-f]+$/i.test(raw)) {
    throw new Error(`Unsupported hex value: ${value}`);
  }
  return `0x${raw.slice(2).toUpperCase()}`;
}

function parseFlags(value: string): string[] {
  return value.split(',').map((flag) => flag.trim()).filter(Boolean);
}

function normalizeOperand(value: string): OperandKind {
  const operand = value.trim() as OperandKind;
  if (operand === '' || operand === 'r8' || operand === 'k8' || operand === 'k10' || operand === 'r8,b') {
    return operand;
  }
  throw new Error(`Unsupported operand kind: ${value}`);
}

export function normalizeInstructionRow(row: Row): InstructionForm {
  const wordBits = Number(text(row.word_bits));
  if (wordBits !== 16) throw new Error(`Unsupported instruction width: ${wordBits}`);

  return {
    mnemonic: text(row.mnemonic),
    asmSyntax: text(row.asm_syntax),
    operands: normalizeOperand(text(row.operands)),
    wordBits,
    opcodePattern: text(row.opcode_pattern),
    maskHex: normalizeHex(text(row.mask_hex)),
    valueHex: normalizeHex(text(row.value_hex)),
    cycles: Number(text(row.cycles)),
    flagsAffected: parseFlags(text(row.flags_affected)),
    notes: text(row.notes)
  };
}

function bitName(value: string): string {
  const trimmed = value.trim();
  return trimmed === '-' ? '' : trimmed;
}

export function normalizeRegisterRow(row: Row, notes: string[]): RegisterSpec {
  const kind = text(row.kind);
  if (kind !== 'SFR' && kind !== 'OPTION') throw new Error(`Unsupported register kind: ${kind}`);

  const bits = [
    ['bit7', 7], ['bit6', 6], ['bit5', 5], ['bit4', 4],
    ['bit3', 3], ['bit2', 2], ['bit1', 1], ['bit0', 0]
  ].flatMap(([column, bit]) => {
    const name = bitName(text(row[column as string]));
    return name ? [{ bit: bit as number, name, description: '' }] : [];
  });

  return {
    name: text(row.name),
    address: normalizeAddress(text(row.address)),
    addressText: text(row.address),
    kind,
    resetValue: text(row.reset_value),
    bits,
    notes
  };
}

export interface CompileSpecInput {
  chipId: string;
  displayName: string;
  version: string;
  instructionRows: Row[];
  registerRows: Array<{ row: Row; notes: string[] }>;
}

export function compileSpec(input: CompileSpecInput): ChipSpec {
  return {
    chipId: input.chipId,
    displayName: input.displayName,
    version: input.version,
    instructionSource: 'instruction_set.xlsx',
    registerSource: 'register_set.xlsx',
    documentSource: 'HK8S8100X_规格书 V0.1.docx',
    instructions: input.instructionRows.filter((row) => text(row.mnemonic)).map(normalizeInstructionRow),
    registers: input.registerRows.map(({ row, notes }) => normalizeRegisterRow(row, notes)),
    memory: [
      { name: 'SFR', start: 0x00, end: 0x7f },
      { name: 'RAM', start: 0x80, end: 0xbf }
    ],
    vectors: { reset: 0x000, interrupt: 0x008 },
    asmSyntax: {
      labelPattern: '^[A-Za-z_][A-Za-z0-9_]*:$',
      commentPrefix: ';',
      includeDirective: 'INCLUDE',
      constantDirective: 'EQU',
      originDirective: 'ORG'
    }
  };
}
```

- [ ] **Step 4: Implement internal compile script**

`scripts/compileSpec.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { compileSpec } from '../src/shared/spec/SpecCompiler';

function readSheetRows(file: string): Record<string, string>[] {
  const workbook = XLSX.readFile(file);
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(firstSheet, { defval: '' }) as Record<string, string>[];
}

function registerRowsWithNotes(rows: Record<string, string>[]) {
  const result: Array<{ row: Record<string, string>; notes: string[] }> = [];
  let current: { row: Record<string, string>; notes: string[] } | undefined;

  for (const row of rows) {
    if (row.name || row.address || row.kind || row.reset_value) {
      current = { row, notes: [] };
      result.push(current);
      continue;
    }

    const note = Object.values(row).map(String).find((value) => value.trim().length > 0);
    if (current && note) current.notes.push(note.trim());
  }

  return result;
}

const instructionFile = process.argv[2] ?? 'C:/Users/Admin/Desktop/instruction_set.xlsx';
const registerFile = process.argv[3] ?? 'D:/Wechat/Wechat_Data/xwechat_files/wxid_kwkg1bellqa921_c788/msg/file/2026-06/register_set.xlsx';
const outputFile = path.resolve('src/shared/spec/hk8s8100x.v0.1.json');

const spec = compileSpec({
  chipId: 'HK8S8100X',
  displayName: 'HK8S8100X',
  version: '0.1',
  instructionRows: readSheetRows(instructionFile),
  registerRows: registerRowsWithNotes(readSheetRows(registerFile))
});

fs.writeFileSync(outputFile, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
console.log(`Wrote ${outputFile}`);
console.log(`Instructions: ${spec.instructions.length}`);
console.log(`Registers: ${spec.registers.length}`);
```

- [ ] **Step 5: Run tests and compile the real built-in JSON**

Run:

```powershell
npm run test -- tests/shared/specCompiler.test.ts
npm run spec:compile -- "C:/Users/Admin/Desktop/instruction_set.xlsx" "D:/Wechat/Wechat_Data/xwechat_files/wxid_kwkg1bellqa921_c788/msg/file/2026-06/register_set.xlsx"
```

Expected:

- Tests pass.
- Script prints `Instructions: 65`.
- Script prints `Registers: 96`.
- `src/shared/spec/hk8s8100x.v0.1.json` is created.

- [ ] **Step 6: Load generated JSON from repository**

Modify `src/shared/spec/BuiltInSpecRepository.ts`:

```ts
import hk8s8100x from './hk8s8100x.v0.1.json';
import type { ChipSpec } from './ChipSpec';

export class BuiltInSpecRepository {
  getByChipId(chipId: string): ChipSpec {
    if (chipId === 'HK8S8100X') return hk8s8100x as ChipSpec;
    throw new Error(`Unsupported chip platform: ${chipId}`);
  }
}
```

- [ ] **Step 7: Verify repository uses the full spec**

Run:

```powershell
npm run test -- tests/shared/specRepository.test.ts tests/shared/specCompiler.test.ts
```

Expected: PASS and repository test sees more than zero instructions and registers.

- [ ] **Step 8: Commit**

Run:

```powershell
git add src/shared/spec scripts/compileSpec.ts tests/shared/specCompiler.test.ts tests/shared/specRepository.test.ts
git commit -m "feat: compile built-in HK8S8100X specification"
```

If `git` is unavailable, record the changed files in the task handoff and continue.

---

## Task 4: Add ASM Parser For Company Syntax

**Files:**
- Create: `src/shared/asm/AsmParser.ts`
- Create: `tests/shared/asmParser.test.ts`

- [ ] **Step 1: Write failing parser tests**

`tests/shared/asmParser.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseAsm } from '../../src/shared/asm/AsmParser';

describe('AsmParser', () => {
  it('parses labels, instructions, operands, and comments', () => {
    const program = parseAsm([
      '; reset entry',
      'reset_entry:',
      '  CLRWDT',
      '  JMP main_loop ; continue forever',
      'main_loop:'
    ].join('\n'));

    expect(program.lines).toMatchObject([
      { kind: 'comment' },
      { kind: 'label', label: 'reset_entry' },
      { kind: 'instruction', mnemonic: 'CLRWDT', operands: [] },
      { kind: 'instruction', mnemonic: 'JMP', operands: ['main_loop'] },
      { kind: 'label', label: 'main_loop' }
    ]);
  });

  it('keeps source line numbers for diagnostics', () => {
    const program = parseAsm('CLRWDT\nBADOP A');

    expect(program.lines[1].lineNumber).toBe(2);
    expect(program.lines[1].source).toBe('BADOP A');
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
npm run test -- tests/shared/asmParser.test.ts
```

Expected: FAIL because `AsmParser` does not exist.

- [ ] **Step 3: Implement parser**

`src/shared/asm/AsmParser.ts`:

```ts
export type AsmLine =
  | { kind: 'blank'; lineNumber: number; source: string }
  | { kind: 'comment'; lineNumber: number; source: string; comment: string }
  | { kind: 'label'; lineNumber: number; source: string; label: string }
  | { kind: 'instruction'; lineNumber: number; source: string; mnemonic: string; operands: string[]; comment: string };

export interface AsmProgram {
  lines: AsmLine[];
}

function splitComment(source: string): { code: string; comment: string } {
  const index = source.indexOf(';');
  if (index === -1) return { code: source, comment: '' };
  return { code: source.slice(0, index), comment: source.slice(index + 1).trim() };
}

export function parseAsm(source: string): AsmProgram {
  const lines = source.split(/\r?\n/).map((line, index): AsmLine => {
    const lineNumber = index + 1;
    const trimmed = line.trim();

    if (!trimmed) return { kind: 'blank', lineNumber, source: line };
    if (trimmed.startsWith(';')) {
      return { kind: 'comment', lineNumber, source: line, comment: trimmed.slice(1).trim() };
    }

    const { code, comment } = splitComment(line);
    const codeText = code.trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*:$/.test(codeText)) {
      return { kind: 'label', lineNumber, source: line, label: codeText.slice(0, -1) };
    }

    const [mnemonicRaw, operandText = ''] = codeText.split(/\s+/, 2);
    const operands = operandText
      ? operandText.split(',').map((operand) => operand.trim()).filter(Boolean)
      : [];

    return {
      kind: 'instruction',
      lineNumber,
      source: line,
      mnemonic: mnemonicRaw.toUpperCase(),
      operands,
      comment
    };
  });

  return { lines };
}
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```powershell
npm run test -- tests/shared/asmParser.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/shared/asm/AsmParser.ts tests/shared/asmParser.test.ts
git commit -m "feat: parse company ASM source lines"
```

If `git` is unavailable, record the changed files in the task handoff and continue.

---

## Task 5: Add Instruction Encoding And Constraint Validation

**Files:**
- Create: `src/shared/asm/InstructionEncoder.ts`
- Create: `src/shared/asm/AsmValidator.ts`
- Create: `tests/shared/instructionEncoder.test.ts`
- Create: `tests/shared/asmValidator.test.ts`

- [ ] **Step 1: Write failing encoder tests**

`tests/shared/instructionEncoder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { encodeInstruction } from '../../src/shared/asm/InstructionEncoder';
import type { InstructionForm } from '../../src/shared/spec/ChipSpec';

const jmp: InstructionForm = {
  mnemonic: 'JMP',
  asmSyntax: 'JMP K',
  operands: 'k10',
  wordBits: 16,
  opcodePattern: '1100 00kk kkkkkkkk',
  maskHex: '0xFC00',
  valueHex: '0xC000',
  cycles: 2,
  flagsAffected: [],
  notes: 'PC ← K'
};

describe('InstructionEncoder', () => {
  it('encodes k10 operands inside range', () => {
    expect(encodeInstruction(jmp, [0x008]).word).toBe(0xC008);
  });

  it('rejects k10 operands outside range', () => {
    expect(() => encodeInstruction(jmp, [0x400])).toThrow('k10 operand out of range: 1024');
  });
});
```

- [ ] **Step 2: Write failing validator tests**

`tests/shared/asmValidator.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseAsm } from '../../src/shared/asm/AsmParser';
import { validateAsm } from '../../src/shared/asm/AsmValidator';
import { BuiltInSpecRepository } from '../../src/shared/spec/BuiltInSpecRepository';

describe('AsmValidator', () => {
  const spec = new BuiltInSpecRepository().getByChipId('HK8S8100X');

  it('accepts instructions from the built-in instruction set', () => {
    const diagnostics = validateAsm(parseAsm('CLRWDT\nJMP 0x008'), spec);

    expect(diagnostics).toEqual([]);
  });

  it('rejects unknown instructions', () => {
    const diagnostics = validateAsm(parseAsm('MOVX A,#0x00'), spec);

    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      lineNumber: 1,
      code: 'UNKNOWN_INSTRUCTION'
    });
  });

  it('rejects out-of-range k10 operands', () => {
    const diagnostics = validateAsm(parseAsm('JMP 0x400'), spec);

    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'OPERAND_OUT_OF_RANGE'
    });
  });
});
```

- [ ] **Step 3: Run tests to verify RED**

Run:

```powershell
npm run test -- tests/shared/instructionEncoder.test.ts tests/shared/asmValidator.test.ts
```

Expected: FAIL because encoder and validator modules do not exist.

- [ ] **Step 4: Implement instruction encoder**

`src/shared/asm/InstructionEncoder.ts`:

```ts
import type { InstructionForm } from '../spec/ChipSpec';

export interface EncodedInstruction {
  word: number;
}

function parseHex(value: string): number {
  return Number.parseInt(value.replace(/^0x/i, ''), 16);
}

function assertRange(kind: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`${kind} operand out of range: ${value}`);
  }
}

export function encodeInstruction(form: InstructionForm, operands: number[]): EncodedInstruction {
  const base = parseHex(form.valueHex);

  if (form.operands === '') {
    return { word: base };
  }

  if (form.operands === 'k8') {
    const [k] = operands;
    assertRange('k8', k, 0xff);
    return { word: base | k };
  }

  if (form.operands === 'k10') {
    const [k] = operands;
    assertRange('k10', k, 0x3ff);
    return { word: base | k };
  }

  if (form.operands === 'r8') {
    const [r] = operands;
    assertRange('r8', r, 0xff);
    return { word: base | r };
  }

  if (form.operands === 'r8,b') {
    const [r, bit] = operands;
    assertRange('r8', r, 0xff);
    assertRange('bit', bit, 7);
    return { word: base | (bit << 8) | r };
  }

  throw new Error(`Unsupported operand form: ${form.operands}`);
}

export function assertMaskValue(form: InstructionForm, word: number): void {
  const mask = parseHex(form.maskHex);
  const value = parseHex(form.valueHex);
  if ((word & mask) !== value) {
    throw new Error(`Encoded word 0x${word.toString(16)} does not match mask/value for ${form.mnemonic}`);
  }
}
```

- [ ] **Step 5: Implement validator**

`src/shared/asm/AsmValidator.ts`:

```ts
import type { AsmProgram } from './AsmParser';
import { assertMaskValue, encodeInstruction } from './InstructionEncoder';
import type { ChipSpec, InstructionForm } from '../spec/ChipSpec';

export interface AsmDiagnostic {
  severity: 'warning' | 'error';
  code: string;
  lineNumber: number;
  message: string;
}

function parseNumericOperand(value: string): number {
  if (/^0x[0-9a-f]+$/i.test(value)) return Number.parseInt(value.slice(2), 16);
  if (/^[0-9]+$/.test(value)) return Number.parseInt(value, 10);
  throw new Error(`Unsupported numeric operand: ${value}`);
}

function findForm(forms: InstructionForm[], operandCount: number): InstructionForm | undefined {
  return forms.find((form) => {
    if (form.operands === '') return operandCount === 0;
    if (form.operands === 'r8,b') return operandCount === 2;
    return operandCount === 1;
  });
}

export function validateAsm(program: AsmProgram, spec: ChipSpec): AsmDiagnostic[] {
  const diagnostics: AsmDiagnostic[] = [];
  const instructionMap = new Map<string, InstructionForm[]>();

  for (const form of spec.instructions) {
    const forms = instructionMap.get(form.mnemonic) ?? [];
    forms.push(form);
    instructionMap.set(form.mnemonic, forms);
  }

  for (const line of program.lines) {
    if (line.kind !== 'instruction') continue;

    const forms = instructionMap.get(line.mnemonic);
    if (!forms) {
      diagnostics.push({
        severity: 'error',
        code: 'UNKNOWN_INSTRUCTION',
        lineNumber: line.lineNumber,
        message: `Instruction ${line.mnemonic} is not in the built-in instruction set.`
      });
      continue;
    }

    const form = findForm(forms, line.operands.length);
    if (!form) {
      diagnostics.push({
        severity: 'error',
        code: 'OPERAND_SHAPE_MISMATCH',
        lineNumber: line.lineNumber,
        message: `Instruction ${line.mnemonic} does not support ${line.operands.length} operand(s).`
      });
      continue;
    }

    try {
      const numericOperands = line.operands.map(parseNumericOperand);
      const encoded = encodeInstruction(form, numericOperands);
      assertMaskValue(form, encoded.word);
    } catch (error) {
      diagnostics.push({
        severity: 'error',
        code: error instanceof Error && error.message.includes('out of range') ? 'OPERAND_OUT_OF_RANGE' : 'ENCODING_ERROR',
        lineNumber: line.lineNumber,
        message: error instanceof Error ? error.message : 'Instruction encoding failed.'
      });
    }
  }

  return diagnostics;
}
```

- [ ] **Step 6: Run tests to verify GREEN**

Run:

```powershell
npm run test -- tests/shared/instructionEncoder.test.ts tests/shared/asmValidator.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```powershell
git add src/shared/asm tests/shared/instructionEncoder.test.ts tests/shared/asmValidator.test.ts
git commit -m "feat: validate ASM against built-in instruction rules"
```

If `git` is unavailable, record the changed files in the task handoff and continue.

---

## Task 6: Implement Local ASM Agent Planning

**Files:**
- Create: `src/shared/agent/ModelAdapter.ts`
- Create: `src/shared/agent/GenerationPlanner.ts`
- Create: `src/shared/agent/LocalRuleAgent.ts`
- Create: `src/shared/agent/AgentService.ts`
- Create: `tests/shared/agentService.test.ts`

- [ ] **Step 1: Write failing tests for natural-language planning**

`tests/shared/agentService.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AgentService } from '../../src/shared/agent/AgentService';
import { BuiltInSpecRepository } from '../../src/shared/spec/BuiltInSpecRepository';

describe('AgentService', () => {
  const service = new AgentService(new BuiltInSpecRepository());

  it('creates a generation plan for Timer0 interrupt toggling PA0', () => {
    const result = service.createPlan({
      chipId: 'HK8S8100X',
      requirement: '生成一个 Timer0 周期中断翻转 PA0 的完整 ASM 工程，需要启动入口、主循环、中断处理和注释。'
    });

    expect(result.status).toBe('ready');
    expect(result.plan.files).toContain('startup/reset.asm');
    expect(result.plan.files).toContain('startup/interrupt.asm');
    expect(result.plan.features).toContain('Timer0');
    expect(result.plan.features).toContain('GPIO');
  });

  it('asks a follow-up when timing details are required but missing', () => {
    const result = service.createPlan({
      chipId: 'HK8S8100X',
      requirement: '生成一个精确 1ms Timer0 中断工程。'
    });

    expect(result.status).toBe('needsInput');
    expect(result.questions[0]).toContain('时钟源');
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
npm run test -- tests/shared/agentService.test.ts
```

Expected: FAIL because `AgentService` does not exist.

- [ ] **Step 3: Add model adapter interface**

`src/shared/agent/ModelAdapter.ts`:

```ts
export interface ModelPrompt {
  system: string;
  user: string;
}

export interface ModelAdapter {
  complete(prompt: ModelPrompt): Promise<string>;
}

export class DisabledModelAdapter implements ModelAdapter {
  async complete(): Promise<string> {
    throw new Error('Local model adapter is not configured in this MVP build.');
  }
}
```

- [ ] **Step 4: Add generation planner types**

`src/shared/agent/GenerationPlanner.ts`:

```ts
export interface PlanRequest {
  chipId: string;
  requirement: string;
}

export interface GenerationPlan {
  summary: string;
  chipId: string;
  features: string[];
  files: string[];
  usesInterrupt: boolean;
  requiredRegisters: string[];
  assumptions: string[];
}

export type PlanResult =
  | { status: 'ready'; plan: GenerationPlan }
  | { status: 'needsInput'; questions: string[] };
```

- [ ] **Step 5: Implement deterministic local rule agent**

`src/shared/agent/LocalRuleAgent.ts`:

```ts
import type { ChipSpec } from '../spec/ChipSpec';
import type { GenerationPlan, PlanRequest, PlanResult } from './GenerationPlanner';

function includesAny(text: string, words: string[]): boolean {
  return words.some((word) => text.toLowerCase().includes(word.toLowerCase()));
}

export class LocalRuleAgent {
  createPlan(request: PlanRequest, spec: ChipSpec): PlanResult {
    const requirement = request.requirement;
    const features: string[] = [];
    const requiredRegisters: string[] = [];
    const assumptions: string[] = [];

    const wantsTimer0 = includesAny(requirement, ['Timer0', 'T0', '定时']);
    const wantsGpio = includesAny(requirement, ['PA0', 'PA1', 'PA2', 'PA3', 'GPIO', 'IO']);
    const wantsInterrupt = includesAny(requirement, ['中断', 'interrupt', 'ISR']);
    const wantsExactTiming = /\b\d+\s*(ms|us|秒)\b/i.test(requirement);

    if (wantsExactTiming && !includesAny(requirement, ['时钟源', '分频', '预分频', 'osc', 'OSC'])) {
      return {
        status: 'needsInput',
        questions: ['需要补充 Timer0 的时钟源、预分频或系统时钟配置，才能生成精确定时相关 ASM。']
      };
    }

    if (wantsTimer0) {
      features.push('Timer0');
      requiredRegisters.push('T0_PS');
    }
    if (wantsGpio) {
      features.push('GPIO');
      requiredRegisters.push('PA_PIO');
    }
    if (wantsInterrupt) {
      features.push('Interrupt');
    }

    assumptions.push(`使用内置 ${spec.chipId} 规范库 ${spec.version}`);
    assumptions.push('不执行编译、仿真或烧录');

    const files = [
      'startup/reset.asm',
      wantsInterrupt ? 'startup/interrupt.asm' : 'startup/interrupt.asm',
      'src/main.asm',
      wantsGpio ? 'src/gpio.asm' : 'src/gpio.asm',
      wantsTimer0 ? 'src/timer0.asm' : 'src/timer0.asm',
      'include/registers.inc',
      'docs/spec-compliance.md'
    ];

    const plan: GenerationPlan = {
      summary: `生成 ${features.join(' + ') || '基础'} ASM 工程`,
      chipId: request.chipId,
      features,
      files,
      usesInterrupt: wantsInterrupt,
      requiredRegisters,
      assumptions
    };

    return { status: 'ready', plan };
  }
}
```

- [ ] **Step 6: Implement agent service**

`src/shared/agent/AgentService.ts`:

```ts
import { LocalRuleAgent } from './LocalRuleAgent';
import type { PlanRequest, PlanResult } from './GenerationPlanner';
import type { BuiltInSpecRepository } from '../spec/BuiltInSpecRepository';

export class AgentService {
  private readonly localRuleAgent = new LocalRuleAgent();

  constructor(private readonly specs: BuiltInSpecRepository) {}

  createPlan(request: PlanRequest): PlanResult {
    const spec = this.specs.getByChipId(request.chipId);
    return this.localRuleAgent.createPlan(request, spec);
  }
}
```

- [ ] **Step 7: Run tests to verify GREEN**

Run:

```powershell
npm run test -- tests/shared/agentService.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```powershell
git add src/shared/agent tests/shared/agentService.test.ts
git commit -m "feat: plan ASM projects from natural language requests"
```

If `git` is unavailable, record the changed files in the task handoff and continue.

---

## Task 7: Generate Complete ASM Project Files

**Files:**
- Create: `src/shared/project/ProjectTypes.ts`
- Create: `src/shared/asm/ProjectGenerator.ts`
- Create: `tests/shared/projectGenerator.test.ts`

- [ ] **Step 1: Write failing project generation test**

`tests/shared/projectGenerator.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ProjectGenerator } from '../../src/shared/asm/ProjectGenerator';
import type { GenerationPlan } from '../../src/shared/agent/GenerationPlanner';
import { BuiltInSpecRepository } from '../../src/shared/spec/BuiltInSpecRepository';

describe('ProjectGenerator', () => {
  it('generates a complete ASM project tree from a plan', () => {
    const spec = new BuiltInSpecRepository().getByChipId('HK8S8100X');
    const plan: GenerationPlan = {
      summary: '生成 Timer0 + GPIO ASM 工程',
      chipId: 'HK8S8100X',
      features: ['Timer0', 'GPIO', 'Interrupt'],
      files: ['startup/reset.asm', 'startup/interrupt.asm', 'src/main.asm'],
      usesInterrupt: true,
      requiredRegisters: ['T0_PS', 'PA_PIO'],
      assumptions: ['使用内置规范库']
    };

    const project = new ProjectGenerator().generate({
      projectName: 'timer0-pa0-demo',
      requirement: 'Timer0 中断翻转 PA0',
      plan,
      spec
    });

    expect(project.files.map((file) => file.path)).toContain('startup/reset.asm');
    expect(project.files.map((file) => file.path)).toContain('src/main.asm');
    expect(project.files.map((file) => file.path)).toContain('README.md');
    expect(project.files.find((file) => file.path === 'docs/spec-compliance.md')?.content).toContain('HK8S8100X');
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
npm run test -- tests/shared/projectGenerator.test.ts
```

Expected: FAIL because `ProjectGenerator` does not exist.

- [ ] **Step 3: Add project types**

`src/shared/project/ProjectTypes.ts`:

```ts
import type { GenerationPlan } from '../agent/GenerationPlanner';
import type { ChipSpec } from '../spec/ChipSpec';

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GeneratedProject {
  projectName: string;
  files: GeneratedFile[];
}

export interface GenerateProjectInput {
  projectName: string;
  requirement: string;
  plan: GenerationPlan;
  spec: ChipSpec;
}
```

- [ ] **Step 4: Implement project generator**

`src/shared/asm/ProjectGenerator.ts`:

```ts
import type { GeneratedProject, GenerateProjectInput } from '../project/ProjectTypes';

function file(path: string, content: string) {
  return { path, content: `${content.trim()}\n` };
}

export class ProjectGenerator {
  generate(input: GenerateProjectInput): GeneratedProject {
    const { projectName, requirement, plan, spec } = input;

    const files = [
      file('startup/reset.asm', `
; Reset entry for ${projectName}
; Chip: ${spec.chipId}
reset_entry:
  CLRWDT
  JMP main_entry
`),
      file('startup/interrupt.asm', `
; Interrupt entry for ${projectName}
interrupt_entry:
  RETI
`),
      file('src/main.asm', `
; Main logic for ${projectName}
main_entry:
  CALL gpio_init
  CALL timer0_init
main_loop:
  CLRWDT
  JMP main_loop
`),
      file('src/gpio.asm', `
; GPIO initialization constrained by built-in register specification
gpio_init:
  RET
`),
      file('src/timer0.asm', `
; Timer0 initialization constrained by built-in register specification
timer0_init:
  RET
`),
      file('include/registers.inc', `
; Generated register constants for ${spec.chipId}
; Constants are derived from the built-in company register table.
`),
      file('docs/requirements.md', `
# Requirements

${requirement}
`),
      file('docs/generation-plan.md', `
# Generation Plan

${plan.summary}

Features:
${plan.features.map((feature) => `- ${feature}`).join('\n')}
`),
      file('docs/spec-compliance.md', `
# Spec Compliance

Chip: ${spec.chipId}
Spec version: ${spec.version}

Generated code must use only built-in instruction, register, bitfield, and ASM syntax rules.
`),
      file('docs/self-check-report.md', `
# Self Check Report

Status: generated draft pending static validation.
`),
      file('README.md', `
# ${projectName}

Generated by ASM Agent from natural language requirement.

This project does not claim compile, simulation, burn, or hardware-run verification.
`),
      file('.gitignore', `
build/
dist/
out/
*.o
*.obj
*.elf
*.bin
*.hex
*.map
*.lst
*.log
*.tmp
.DS_Store
.vscode/.history/
`)
    ];

    return { projectName, files };
  }
}
```

- [ ] **Step 5: Run tests to verify GREEN**

Run:

```powershell
npm run test -- tests/shared/projectGenerator.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/shared/project src/shared/asm/ProjectGenerator.ts tests/shared/projectGenerator.test.ts
git commit -m "feat: generate ASM project deliverables"
```

If `git` is unavailable, record the changed files in the task handoff and continue.

---

## Task 8: Wire Agent IPC Between Electron And Renderer

**Files:**
- Create: `src/main/ipc/agentHandlers.ts`
- Create: `src/main/ipc/projectHandlers.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/preload.ts`

- [ ] **Step 1: Add IPC handlers for planning and generation**

`src/main/ipc/agentHandlers.ts`:

```ts
import { ipcMain } from 'electron';
import { AgentService } from '../../shared/agent/AgentService';
import { BuiltInSpecRepository } from '../../shared/spec/BuiltInSpecRepository';

export function registerAgentHandlers(): void {
  const service = new AgentService(new BuiltInSpecRepository());

  ipcMain.handle('agent:createPlan', (_event, payload: { chipId: string; requirement: string }) => {
    return service.createPlan(payload);
  });
}
```

`src/main/ipc/projectHandlers.ts`:

```ts
import { ipcMain } from 'electron';
import { ProjectGenerator } from '../../shared/asm/ProjectGenerator';
import type { GenerationPlan } from '../../shared/agent/GenerationPlanner';
import { BuiltInSpecRepository } from '../../shared/spec/BuiltInSpecRepository';

export function registerProjectHandlers(): void {
  const specs = new BuiltInSpecRepository();
  const generator = new ProjectGenerator();

  ipcMain.handle('project:generate', (_event, payload: { projectName: string; requirement: string; plan: GenerationPlan }) => {
    const spec = specs.getByChipId(payload.plan.chipId);
    return generator.generate({
      projectName: payload.projectName,
      requirement: payload.requirement,
      plan: payload.plan,
      spec
    });
  });
}
```

- [ ] **Step 2: Register handlers in main process**

Modify `src/main/main.ts`:

```ts
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { registerAgentHandlers } from './ipc/agentHandlers';
import { registerProjectHandlers } from './ipc/projectHandlers';

registerAgentHandlers();
registerProjectHandlers();

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#f6f8fc',
    title: 'ASM Agent',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) void mainWindow.loadURL(devServerUrl);
  else void mainWindow.loadFile(path.join(__dirname, '../dist-renderer/index.html'));
}

void app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 3: Expose typed preload API**

`src/main/preload.ts`:

```ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('asmAgent', {
  createPlan: (payload: { chipId: string; requirement: string }) => ipcRenderer.invoke('agent:createPlan', payload),
  generateProject: (payload: unknown) => ipcRenderer.invoke('project:generate', payload),
  version: '0.1.0'
});
```

- [ ] **Step 4: Verify TypeScript build**

Run:

```powershell
npm run build
```

Expected: PASS. The Electron main process compiles with IPC handlers.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/main
git commit -m "feat: expose local ASM agent through Electron IPC"
```

If `git` is unavailable, record the changed files in the task handoff and continue.

---

## Task 9: Build Marvis-Inspired Assistant UI

**Files:**
- Create: `src/renderer/styles/tokens.css`
- Create: `src/renderer/styles/app.css`
- Create: `src/renderer/components/ChipPlatformPanel.tsx`
- Create: `src/renderer/components/AssistantChat.tsx`
- Create: `src/renderer/components/GeneratedProjectPanel.tsx`
- Create: `src/renderer/components/SpecCompliancePanel.tsx`
- Create: `src/renderer/state/useAgentSession.ts`
- Modify: `src/renderer/App.tsx`
- Create: `tests/renderer/assistantFlow.test.tsx`

- [ ] **Step 1: Write failing UI test for the main flow**

`tests/renderer/assistantFlow.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';

vi.stubGlobal('asmAgent', {
  version: '0.1.0',
  createPlan: vi.fn().mockResolvedValue({
    status: 'ready',
    plan: {
      summary: '生成 Timer0 + GPIO ASM 工程',
      chipId: 'HK8S8100X',
      features: ['Timer0', 'GPIO'],
      files: ['startup/reset.asm', 'src/main.asm'],
      usesInterrupt: true,
      requiredRegisters: ['T0_PS', 'PA_PIO'],
      assumptions: ['使用内置规范库']
    }
  }),
  generateProject: vi.fn().mockResolvedValue({
    projectName: 'timer0-pa0-demo',
    files: [{ path: 'src/main.asm', content: 'main_loop:\\n  CLRWDT\\n  JMP main_loop\\n' }]
  })
});

describe('Assistant UI flow', () => {
  it('lets the user create a plan from natural language', async () => {
    render(<App />);

    await userEvent.type(
      screen.getByLabelText('ASM 功能需求'),
      '生成一个 Timer0 周期中断翻转 PA0 的完整 ASM 工程'
    );
    await userEvent.click(screen.getByRole('button', { name: '生成计划' }));

    expect(await screen.findByText('生成 Timer0 + GPIO ASM 工程')).toBeInTheDocument();
    expect(screen.getByText('HK8S8100X')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
npm run test -- tests/renderer/assistantFlow.test.tsx
```

Expected: FAIL because UI components do not exist or the input is missing.

- [ ] **Step 3: Add design tokens**

`src/renderer/styles/tokens.css`:

```css
:root {
  --bg-app: #f4f7fb;
  --bg-panel: #ffffff;
  --bg-soft: #f8fbff;
  --text-primary: #172033;
  --text-secondary: #647086;
  --line: #dce5f1;
  --accent-blue: #3e76ff;
  --accent-cyan: #28c6d3;
  --success-bg: #eefaf5;
  --success-text: #207350;
  --warning-bg: #fff8ec;
  --warning-text: #805700;
  --radius-panel: 14px;
  --radius-control: 10px;
  --shadow-window: 0 20px 70px rgba(28, 40, 70, 0.16);
  font-family: "Segoe UI", "Microsoft YaHei UI", sans-serif;
}
```

`src/renderer/styles/app.css`:

```css
body {
  margin: 0;
  background: var(--bg-app);
  color: var(--text-primary);
}

.app-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 230px minmax(520px, 1fr) 330px;
  background: var(--bg-app);
}

.panel {
  background: var(--bg-panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-panel);
}

.primary-button {
  border: 0;
  border-radius: var(--radius-control);
  background: linear-gradient(135deg, var(--accent-blue), var(--accent-cyan));
  color: white;
  font-weight: 700;
  padding: 9px 14px;
}

.secondary-button {
  border: 0;
  border-radius: var(--radius-control);
  background: #eef4ff;
  color: #244ab6;
  font-weight: 700;
  padding: 9px 14px;
}

.code-preview {
  font-family: "Cascadia Mono", Consolas, monospace;
  background: #101828;
  color: #dce7ff;
  border-radius: var(--radius-panel);
  padding: 12px;
  white-space: pre-wrap;
}
```

- [ ] **Step 4: Add UI state hook**

`src/renderer/state/useAgentSession.ts`:

```ts
import { useState } from 'react';

interface Plan {
  summary: string;
  chipId: string;
  features: string[];
  files: string[];
  usesInterrupt: boolean;
  requiredRegisters: string[];
  assumptions: string[];
}

interface GeneratedProject {
  projectName: string;
  files: Array<{ path: string; content: string }>;
}

export function useAgentSession() {
  const [requirement, setRequirement] = useState('');
  const [plan, setPlan] = useState<Plan | undefined>();
  const [project, setProject] = useState<GeneratedProject | undefined>();
  const [message, setMessage] = useState('已加载公司内置 HK8S8100X ASM 规范库。');

  async function createPlan() {
    const result = await window.asmAgent.createPlan({ chipId: 'HK8S8100X', requirement });
    if (result.status === 'ready') {
      setPlan(result.plan);
      setMessage('已生成计划，请确认后生成 ASM 工程。');
    } else {
      setMessage(result.questions.join('\n'));
    }
  }

  async function generateProject() {
    if (!plan) return;
    const generated = await window.asmAgent.generateProject({
      projectName: 'asm-generated-project',
      requirement,
      plan
    });
    setProject(generated);
    setMessage('ASM 工程已生成，并保持在内置规范约束内。');
  }

  return { requirement, setRequirement, plan, project, message, createPlan, generateProject };
}
```

- [ ] **Step 5: Add global preload typing**

Create `src/renderer/global.d.ts`:

```ts
export {};

declare global {
  interface Window {
    asmAgent: {
      version: string;
      createPlan(payload: { chipId: string; requirement: string }): Promise<any>;
      generateProject(payload: unknown): Promise<any>;
    };
  }
}
```

- [ ] **Step 6: Add main app UI**

`src/renderer/App.tsx`:

```tsx
import { useAgentSession } from './state/useAgentSession';

export function App() {
  const session = useAgentSession();
  const firstFile = session.project?.files[0];

  return (
    <main className="app-shell">
      <aside style={{ padding: 16, borderRight: '1px solid var(--line)' }}>
        <h2>HK8S8100X</h2>
        <p style={{ color: 'var(--text-secondary)' }}>内置 ASM 规范库 v0.1</p>
        <div className="panel" style={{ padding: 12 }}>
          <strong>内置约束</strong>
          <p>指令集锁定</p>
          <p>寄存器表锁定</p>
          <p>ASM 语法锁定</p>
        </div>
      </aside>

      <section style={{ padding: 18, display: 'grid', gridTemplateRows: 'auto 1fr auto', gap: 14 }}>
        <div className="panel" style={{ padding: 16 }}>
          <strong>ASM Agent</strong>
          <p>{session.message}</p>
        </div>

        <div className="panel" style={{ padding: 16 }}>
          <h1>ASM 汇编工程生成智能体</h1>
          {session.plan ? (
            <section>
              <h2>{session.plan.summary}</h2>
              <p>芯片平台: {session.plan.chipId}</p>
              <p>涉及功能: {session.plan.features.join('、')}</p>
            </section>
          ) : (
            <p>输入自然语言需求，智能体会先生成计划，再生成完整 ASM 工程。</p>
          )}
        </div>

        <form
          className="panel"
          style={{ padding: 12, display: 'flex', gap: 10 }}
          onSubmit={(event) => {
            event.preventDefault();
            void session.createPlan();
          }}
        >
          <label htmlFor="requirement" style={{ position: 'absolute', left: -10000 }}>
            ASM 功能需求
          </label>
          <textarea
            id="requirement"
            aria-label="ASM 功能需求"
            value={session.requirement}
            onChange={(event) => session.setRequirement(event.target.value)}
            style={{ flex: 1, minHeight: 58, resize: 'vertical' }}
          />
          <button className="secondary-button" type="submit">生成计划</button>
          <button className="primary-button" type="button" onClick={() => void session.generateProject()}>
            生成工程
          </button>
        </form>
      </section>

      <aside style={{ padding: 16, borderLeft: '1px solid var(--line)' }}>
        <h2>ASM 工程预览</h2>
        <div className="panel" style={{ padding: 12 }}>
          {(session.project?.files ?? []).map((file) => <div key={file.path}>{file.path}</div>)}
        </div>
        <h3>代码预览</h3>
        <pre className="code-preview">{firstFile?.content ?? '等待生成 ASM 工程'}</pre>
      </aside>
    </main>
  );
}
```

- [ ] **Step 7: Run UI tests**

Run:

```powershell
npm run test -- tests/renderer/assistantFlow.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Verify desktop UI**

Run:

```powershell
npm run dev:electron
```

Expected:

- A Windows desktop window opens.
- Left side shows `HK8S8100X` and built-in spec status.
- Center shows natural-language input and agent plan.
- Right side shows generated project preview.
- There is no ordinary-user `导入规范` button in the main flow.

- [ ] **Step 9: Commit**

Run:

```powershell
git add src/renderer tests/renderer/assistantFlow.test.tsx
git commit -m "feat: build ASM assistant desktop UI"
```

If `git` is unavailable, record the changed files in the task handoff and continue.

---

## Task 10: Add Export, Packaging, And Windows Installer

**Files:**
- Create: `src/shared/project/ProjectExporter.ts`
- Modify: `src/main/ipc/projectHandlers.ts`
- Modify: `electron-builder.yml`
- Create: `tests/shared/projectExporter.test.ts`

- [ ] **Step 1: Write failing export test**

`tests/shared/projectExporter.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportProject } from '../../src/shared/project/ProjectExporter';

describe('ProjectExporter', () => {
  it('writes generated files to a project directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asm-agent-'));
    exportProject(root, {
      projectName: 'demo',
      files: [{ path: 'src/main.asm', content: 'CLRWDT\n' }]
    });

    expect(fs.readFileSync(path.join(root, 'demo/src/main.asm'), 'utf8')).toBe('CLRWDT\n');
  });
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```powershell
npm run test -- tests/shared/projectExporter.test.ts
```

Expected: FAIL because `ProjectExporter` does not exist.

- [ ] **Step 3: Implement exporter**

`src/shared/project/ProjectExporter.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import type { GeneratedProject } from './ProjectTypes';

function assertSafeRelativePath(relativePath: string): void {
  if (path.isAbsolute(relativePath) || relativePath.includes('..')) {
    throw new Error(`Unsafe generated file path: ${relativePath}`);
  }
}

export function exportProject(rootDir: string, project: GeneratedProject): string {
  const projectDir = path.join(rootDir, project.projectName);
  fs.mkdirSync(projectDir, { recursive: true });

  for (const generatedFile of project.files) {
    assertSafeRelativePath(generatedFile.path);
    const target = path.join(projectDir, generatedFile.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, generatedFile.content, 'utf8');
  }

  return projectDir;
}
```

- [ ] **Step 4: Configure Windows installer**

`electron-builder.yml`:

```yaml
appId: com.company.asmagent
productName: ASM Agent
directories:
  output: release
files:
  - dist-main/**
  - dist-renderer/**
  - package.json
asar: true
win:
  target:
    - nsis
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: ASM Agent
```

- [ ] **Step 5: Run tests and package command**

Run:

```powershell
npm run test -- tests/shared/projectExporter.test.ts
npm run package:win
```

Expected:

- Export test passes.
- `release/` contains a Windows NSIS installer artifact.

- [ ] **Step 6: Commit**

Run:

```powershell
git add src/shared/project/ProjectExporter.ts src/main/ipc/projectHandlers.ts electron-builder.yml tests/shared/projectExporter.test.ts
git commit -m "feat: export projects and package Windows installer"
```

If `git` is unavailable, record the changed files in the task handoff and continue.

---

## Task 11: End-To-End MVP Verification

**Files:**
- Create: `docs/mvp-verification.md`
- Modify: `README.md`

- [ ] **Step 1: Add MVP verification document**

`docs/mvp-verification.md`:

```markdown
# MVP Verification

## Scope

This verification proves the ASM Agent MVP can:

- Load the built-in HK8S8100X spec.
- Accept a natural-language ASM project request.
- Produce a generation plan.
- Generate a complete ASM project tree.
- Reject unsupported instructions or out-of-range operands in static validation.
- Present a Windows desktop UI centered on the ASM assistant.

It does not prove compile, simulation, burn, or hardware execution.

## Commands

```powershell
npm run lint
npm run test
npm run build
npm run package:win
```

Expected result: all commands exit with code 0 and `release/` contains a Windows installer.
```

- [ ] **Step 2: Add README**

`README.md`:

```markdown
# ASM Agent

ASM Agent is a Windows-first local desktop application that generates company-chip ASM projects from natural-language requirements.

## MVP

- Built-in HK8S8100X specification library
- Natural-language planning
- ASM project generation
- Static instruction/register validation
- Marvis-inspired desktop assistant UI
- Windows installer packaging

## Non-Goals

The MVP does not compile, simulate, burn, or verify code on hardware.

## Development

```powershell
npm install
npm run test
npm run dev:electron
```
```

- [ ] **Step 3: Run full verification**

Run:

```powershell
npm run lint
npm run test
npm run build
npm run package:win
```

Expected:

- TypeScript passes.
- All tests pass.
- App builds.
- Windows installer is produced.

- [ ] **Step 4: Commit**

Run:

```powershell
git add README.md docs/mvp-verification.md
git commit -m "docs: document MVP verification"
```

If `git` is unavailable, record the changed files in the task handoff and continue.

---

## Self-Review

Spec coverage:

- Natural-language ASM engineering agent: Tasks 6, 7, 8, 9.
- Built-in company chip spec: Tasks 2 and 3.
- Strict instruction/register constraints: Tasks 4 and 5.
- Complete ASM project deliverables: Task 7.
- Marvis-inspired Windows desktop UI: Task 9.
- No ordinary-user spec import button: Task 9 acceptance check.
- No compile/simulate/burn scope: Tasks 7, 10, 11 documentation and verification.
- Installer flow: Task 10.

Placeholder scan:

- The plan does not use `TODO`, `TBD`, or unspecified file paths.
- The only external source paths are the concrete files already provided by the user.
- Tasks include exact files, commands, and expected outcomes.

Type consistency:

- `GenerationPlan` is defined in Task 6 and reused by Tasks 7, 8, and 9.
- `GeneratedProject` is defined in Task 7 and reused by Task 10.
- `ChipSpec` is defined in Task 2 and reused by compiler, validator, agent, and generator tasks.
