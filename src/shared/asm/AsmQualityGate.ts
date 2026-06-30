import { parseAsm } from './AsmParser';
import { validateAsm, type AsmDiagnostic } from './AsmValidator';
import type { ChipSpec } from '../spec/ChipSpec';

export function validateAsmSourceQuality(source: string, spec: ChipSpec): AsmDiagnostic[] {
  const program = parseAsm(source);
  return [...collectDialectMismatchDiagnostics(program.lines), ...validateAsm(program, spec)];
}

export function assertAsmSourcePassesQualityGate(source: string, spec: ChipSpec): void {
  const diagnostics = validateAsmSourceQuality(source, spec);
  if (diagnostics.length === 0) return;

  const summary = diagnostics.map(formatAsmDiagnosticForUser).join('；');
  throw new Error(`ASM 质量闸失败：${summary}`);
}

export function formatAsmDiagnosticForUser(diagnostic: AsmDiagnostic): string {
  return `第 ${diagnostic.lineNumber} 行 ${diagnostic.code}：${translateAsmDiagnosticMessage(diagnostic)}`;
}

function translateAsmDiagnosticMessage(diagnostic: AsmDiagnostic): string {
  const message = diagnostic.message;

  if (diagnostic.code === 'UNKNOWN_INSTRUCTION') {
    return `未知指令 ${stripKnownPrefix(message, 'Unknown instruction: ')}`;
  }

  if (diagnostic.code === 'UNKNOWN_REGISTER') {
    return `未知寄存器 ${stripKnownPrefix(message, 'Unknown register: ')}`;
  }

  if (diagnostic.code === 'UNKNOWN_LABEL') {
    return `未知标签 ${stripKnownPrefix(message, 'Unknown label: ')}`;
  }

  if (diagnostic.code === 'OPERAND_OUT_OF_RANGE') {
    return `操作数超出范围：${message}`;
  }

  if (diagnostic.code === 'OPERAND_SHAPE_MISMATCH') {
    if (message.startsWith('Register address must use H suffix: ')) {
      return `寄存器地址必须使用 H 后缀，例如 10H：${stripKnownPrefix(message, 'Register address must use H suffix: ')}`;
    }

    if (message.startsWith('Address operand must use H suffix: ')) {
      return `跳转或调用地址必须使用 H 后缀，例如 20H：${stripKnownPrefix(message, 'Address operand must use H suffix: ')}`;
    }

    return `操作数格式不匹配：${message}`;
  }

  if (diagnostic.code === 'ENCODING_ERROR') {
    return `编码失败：${message}`;
  }

  if (diagnostic.code === 'DIALECT_MISMATCH') {
    return message;
  }

  return message;
}

function stripKnownPrefix(message: string, prefix: string): string {
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

const BANNED_8051_MNEMONICS = new Set([
  'SETB',
  'DJNZ',
  'JB',
  'JNB',
  'JBC',
  'JC',
  'JNC',
  'ORL',
  'ANL',
  'XRL',
  'MOVX',
  'MOVC'
]);

const BANNED_8051_REGISTER_PATTERN = /\bR([0-7])\b/i;
const BANNED_8051_FLAG_PATTERN = /\bCY\b/i;

function collectDialectMismatchDiagnostics(lines: ReturnType<typeof parseAsm>['lines']): AsmDiagnostic[] {
  const diagnostics: AsmDiagnostic[] = [];

  for (const line of lines) {
    if (line.kind !== 'instruction') continue;

    if (BANNED_8051_MNEMONICS.has(line.mnemonic)) {
      diagnostics.push({
        severity: 'error',
        code: 'DIALECT_MISMATCH',
        lineNumber: line.lineNumber,
        message: `检测到疑似 8051 方言指令 ${line.mnemonic}；HK64S8x 成品 ASM 禁止使用 8051/兼容 MCU 的指令、标志位或寄存器写法`
      });
    }

    for (const operand of line.operands) {
      const registerMatch = operand.match(BANNED_8051_REGISTER_PATTERN);
      if (registerMatch) {
        diagnostics.push({
          severity: 'error',
          code: 'DIALECT_MISMATCH',
          lineNumber: line.lineNumber,
          message: `检测到疑似 8051 方言寄存器 ${registerMatch[0].toUpperCase()}；请改用 JSON 规范允许的 RAM H 地址，例如 80H`
        });
      }

      const flagMatch = operand.match(BANNED_8051_FLAG_PATTERN);
      if (flagMatch) {
        diagnostics.push({
          severity: 'error',
          code: 'DIALECT_MISMATCH',
          lineNumber: line.lineNumber,
          message: `检测到疑似 8051 方言标志位 ${flagMatch[0].toUpperCase()}；请改用 HK64S8x 规范中真实存在的寄存器、位字段或显式跳转条件`
        });
      }
    }
  }

  return diagnostics;
}
