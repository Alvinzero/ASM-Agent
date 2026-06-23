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
