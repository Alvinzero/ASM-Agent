import type { PlanRequest, PlanResult } from './GenerationPlanner';
import { LocalRuleAgent } from './LocalRuleAgent';
import type { BuiltInSpecRepository } from '../spec/BuiltInSpecRepository';

export class AgentService {
  private readonly localRuleAgent: LocalRuleAgent;

  constructor(private readonly specRepository: BuiltInSpecRepository) {
    this.localRuleAgent = new LocalRuleAgent();
  }

  async createPlan(request: PlanRequest): Promise<PlanResult> {
    const spec = this.specRepository.getByChipId(request.chipId);
    return this.localRuleAgent.createPlan(request, spec);
  }
}
