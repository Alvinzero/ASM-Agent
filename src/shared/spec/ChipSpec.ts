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
  cyclesRaw: string;
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
