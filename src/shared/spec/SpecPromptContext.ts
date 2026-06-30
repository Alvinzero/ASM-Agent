import type { AsmSyntaxSpec, ChipSpec, InstructionForm, MemoryRegion, RegisterSpec, VectorSpec } from './ChipSpec';

export const BUILT_IN_SPEC_REFERENCE_PATH = 'src/shared/spec/hk64s8x.v0.1.json';

export interface SpecPromptPayload {
  chipId: string;
  displayName: string;
  version: string;
  sourcePath: string;
  instructionSource: string;
  registerSource: string;
  documentSource: string;
  integrity: {
    checksum: string;
    instructions: number;
    registers: number;
  };
  instructions: InstructionForm[];
  registers: RegisterSpec[];
  memory: MemoryRegion[];
  vectors: VectorSpec;
  asmSyntax: AsmSyntaxSpec;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function buildSpecPromptPayload(spec: ChipSpec): SpecPromptPayload {
  const corePayload = {
    chipId: spec.chipId,
    displayName: spec.displayName,
    version: spec.version,
    sourcePath: BUILT_IN_SPEC_REFERENCE_PATH,
    instructionSource: spec.instructionSource,
    registerSource: spec.registerSource,
    documentSource: spec.documentSource,
    instructions: spec.instructions,
    registers: spec.registers,
    memory: spec.memory,
    vectors: spec.vectors,
    asmSyntax: spec.asmSyntax
  };

  return {
    ...corePayload,
    integrity: {
      checksum: `fnv1a32:${fnv1a32(stableStringify(corePayload as unknown as JsonValue))}`,
      instructions: spec.instructions.length,
      registers: spec.registers.length
    }
  };
}

export function renderSpecPromptAttachment(spec: ChipSpec): string {
  const payload = buildSpecPromptPayload(spec);

  return [
    '--- SPEC_DRIVEN_ASM_CONTEXT ---',
    'This block is generated from the built-in company chip JSON specification.',
    `Source file: ${payload.sourcePath}`,
    `Integrity: ${payload.integrity.checksum}; instructions=${payload.integrity.instructions}; registers=${payload.integrity.registers}`,
    'Do not rely on conversation memory as the chip specification.',
    'Do not invent instructions, registers, bit fields, addresses, vectors, or ASM syntax that are absent from this payload.',
    'ASMC syntax rule: numeric register, jump, and call addresses must use the ASMC H suffix, for example 38H, 46H, and 20H. Do not use bare decimal or 0x numeric addresses for R or K operands.',
    'ASMC syntax rule: do not use pseudo instructions such as ORG, END, EQU, DB, DS, DW, SECTION, SEGMENT, INCLUDE, MACRO, or PROC unless they are explicitly listed as instructions in this payload.',
    'ASMC syntax rule: the R token in instruction syntax is an operand placeholder, not a real register name. Do not invent R0, R1, R2, R3, R4, R5, R6, or R7. Use RAM numeric addresses with the H suffix, for example 80H, when a temporary counter is required and the address is within the allowed memory map.',
    'ASMC dialect rule: do not output 8051-style instructions or flags such as SETB, DJNZ, JB, JNB, JBC, JC, JNC, ORL, ANL, XRL, MOVX, MOVC, or CY. They are not valid HK64S8x ASM unless this payload explicitly lists them.',
    'ASMC delay rule: use DECSZR or INCSZR for software delay counters because they write the updated value back to RAM before skip testing. Do not use DECSZ or INCSZ as RAM delay-loop counters because they write the result only to A and can lock the program in one visible state.',
    'ASMC delay rule: estimate software delay from the requested clock frequency. At 16MHz, a three-level DECSZR delay using #0AH/#FFH/#FFH is roughly in the 500ms range; #7AH/#FFH/#FFH is far longer than 500ms and should be rejected for a 500ms requirement.',
    'Candidate ASM is not final. Final ASM must pass local parseAsm + validateAsm against the original JSON spec before display or file output.',
    JSON.stringify(payload),
    '--- END_SPEC_DRIVEN_ASM_CONTEXT ---'
  ].join('\n');
}

export function appendSpecPromptAttachment(systemPrompt: string, spec: ChipSpec): string {
  return [systemPrompt.trim(), renderSpecPromptAttachment(spec)].filter(Boolean).join('\n\n');
}

function stableStringify(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(',')}}`;
}

function fnv1a32(value: string): string {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}
