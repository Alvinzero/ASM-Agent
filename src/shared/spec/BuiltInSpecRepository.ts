import type { ChipSpec } from './ChipSpec';
import hk8s8100xSpec from './hk8s8100x.v0.1.json';

const hk8s8100x = hk8s8100xSpec as ChipSpec;

function cloneChipSpec(spec: ChipSpec): ChipSpec {
  if (typeof structuredClone === 'function') {
    return structuredClone(spec);
  }

  return JSON.parse(JSON.stringify(spec)) as ChipSpec;
}

export class BuiltInSpecRepository {
  getByChipId(chipId: string): ChipSpec {
    if (chipId === hk8s8100x.chipId) return cloneChipSpec(hk8s8100x);
    throw new Error(`Unsupported chip platform: ${chipId}`);
  }
}
