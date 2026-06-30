import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();
const asmSpecPath = 'src/shared/spec/hk64s8x.v0.1.json';
const qualityGateCommand = 'npm run asm:validate -- <file.asm>';

function readProjectFile(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

describe('Spec Kit governance', () => {
  it('pins ASM work to the built-in JSON spec and local quality gate in the constitution', () => {
    const constitution = readProjectFile('.specify/memory/constitution.md');
    const agentGuidance = readProjectFile('AGENTS.md');

    expect(constitution).toContain('# ASM Agent Constitution');
    expect(constitution).toContain(asmSpecPath);
    expect(constitution).toContain('parseAsm + validateAsm');
    expect(constitution).toContain(qualityGateCommand);
    expect(constitution).toContain('CRITICAL');
    expect(constitution).not.toMatch(/\[[A-Z0-9_]+]/);
    expect(agentGuidance).toContain(asmSpecPath);
    expect(agentGuidance).toContain('SPEC_DRIVEN_ASM_CONTEXT');
    expect(agentGuidance).toContain(qualityGateCommand);
  });

  it('installs Codex Spec Kit skills with ASM spec governance attached', () => {
    const requiredSkills = [
      'speckit-analyze',
      'speckit-checklist',
      'speckit-clarify',
      'speckit-constitution',
      'speckit-converge',
      'speckit-implement',
      'speckit-plan',
      'speckit-specify',
      'speckit-tasks',
      'speckit-taskstoissues'
    ];

    for (const skill of requiredSkills) {
      const content = readProjectFile(`.agents/skills/${skill}/SKILL.md`);

      expect(content).toContain(`name: "${skill}"`);
      expect(content).toContain('source: "templates/commands/');
      expect(content).toContain('## ASM JSON Spec Governance');
      expect(content).toContain(asmSpecPath);
      expect(content).toContain('conversation memory');
      expect(content).not.toContain('.specify/.specify/scripts');
    }
  });

  it('keeps Spec Kit templates aligned with the ASM quality gate', () => {
    const planTemplate = readProjectFile('.specify/templates/plan-template.md');
    const specTemplate = readProjectFile('.specify/templates/spec-template.md');
    const tasksTemplate = readProjectFile('.specify/templates/tasks-template.md');
    const checklistCommand = readProjectFile('.agents/skills/speckit-checklist/SKILL.md');

    expect(planTemplate).toContain('ASM Spec Gate');
    expect(planTemplate).toContain(asmSpecPath);
    expect(specTemplate).toContain('ASM features MUST cite the JSON spec');
    expect(tasksTemplate).toContain('Run ASM quality gate');
    expect(tasksTemplate).toContain(qualityGateCommand);
    expect(checklistCommand).toContain('ASM quality checklist');
  });
});
