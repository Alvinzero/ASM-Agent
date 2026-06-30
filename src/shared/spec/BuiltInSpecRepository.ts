import type { ChipSpec } from './ChipSpec';
import hk64s8xSpec from './hk64s8x.v0.1.json';

const hk64s8x = hk64s8xSpec as ChipSpec;

function cloneChipSpec(spec: ChipSpec): ChipSpec {
  if (typeof structuredClone === 'function') {
    return structuredClone(spec);
  }

  return JSON.parse(JSON.stringify(spec)) as ChipSpec;
}

export class BuiltInSpecRepository {
  getByChipId(chipId: string): ChipSpec {
    if (chipId === hk64s8x.chipId) return cloneChipSpec(hk64s8x);
    throw new Error(`Unsupported chip platform: ${chipId}`);
  }
}
