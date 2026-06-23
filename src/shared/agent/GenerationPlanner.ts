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
  | {
      status: 'ready';
      plan: GenerationPlan;
    }
  | {
      status: 'needsInput';
      questions: string[];
    };
