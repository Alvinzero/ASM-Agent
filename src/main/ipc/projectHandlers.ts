import { ipcMain } from 'electron';
import { ProjectGenerator } from '../../shared/asm/ProjectGenerator';
import type { GenerationPlan } from '../../shared/agent/GenerationPlanner';
import { exportProject } from '../../shared/project/ProjectExporter';
import type { GeneratedFile, GeneratedProject } from '../../shared/project/ProjectTypes';
import { BuiltInSpecRepository } from '../../shared/spec/BuiltInSpecRepository';

type GenerateProjectPayload = {
  projectName: string;
  requirement: string;
  plan: GenerationPlan;
};

type ExportProjectPayload = {
  rootDir: string;
  project: GeneratedProject;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function readGenerationPlan(value: unknown): GenerationPlan {
  if (!isRecord(value)) {
    throw new Error('project:generate payload.plan must be an object.');
  }

  if (typeof value.summary !== 'string') {
    throw new Error('project:generate payload.plan.summary must be a string.');
  }

  if (typeof value.chipId !== 'string') {
    throw new Error('project:generate payload.plan.chipId must be a string.');
  }

  if (!isStringArray(value.features)) {
    throw new Error('project:generate payload.plan.features must be a string array.');
  }

  if (!isStringArray(value.files)) {
    throw new Error('project:generate payload.plan.files must be a string array.');
  }

  if (typeof value.usesInterrupt !== 'boolean') {
    throw new Error('project:generate payload.plan.usesInterrupt must be a boolean.');
  }

  if (!isStringArray(value.requiredRegisters)) {
    throw new Error('project:generate payload.plan.requiredRegisters must be a string array.');
  }

  if (!isStringArray(value.assumptions)) {
    throw new Error('project:generate payload.plan.assumptions must be a string array.');
  }

  return {
    summary: value.summary,
    chipId: value.chipId,
    features: value.features,
    files: value.files,
    usesInterrupt: value.usesInterrupt,
    requiredRegisters: value.requiredRegisters,
    assumptions: value.assumptions
  };
}

function readGenerateProjectPayload(payload: unknown): GenerateProjectPayload {
  if (!isRecord(payload)) {
    throw new Error('project:generate payload must be an object.');
  }

  if (typeof payload.projectName !== 'string') {
    throw new Error('project:generate payload.projectName must be a string.');
  }

  if (typeof payload.requirement !== 'string') {
    throw new Error('project:generate payload.requirement must be a string.');
  }

  return {
    projectName: payload.projectName,
    requirement: payload.requirement,
    plan: readGenerationPlan(payload.plan)
  };
}

function readGeneratedFile(value: unknown, index: number): GeneratedFile {
  if (!isRecord(value)) {
    throw new Error(`project:export payload.project.files[${index}] must be an object.`);
  }

  if (typeof value.path !== 'string') {
    throw new Error(`project:export payload.project.files[${index}].path must be a string.`);
  }

  if (typeof value.content !== 'string') {
    throw new Error(`project:export payload.project.files[${index}].content must be a string.`);
  }

  return {
    path: value.path,
    content: value.content
  };
}

function readGeneratedProject(value: unknown): GeneratedProject {
  if (!isRecord(value)) {
    throw new Error('project:export payload.project must be an object.');
  }

  if (typeof value.projectName !== 'string') {
    throw new Error('project:export payload.project.projectName must be a string.');
  }

  if (!Array.isArray(value.files)) {
    throw new Error('project:export payload.project.files must be an array.');
  }

  return {
    projectName: value.projectName,
    files: value.files.map((file, index) => readGeneratedFile(file, index))
  };
}

function readExportProjectPayload(payload: unknown): ExportProjectPayload {
  if (!isRecord(payload)) {
    throw new Error('project:export payload must be an object.');
  }

  if (typeof payload.rootDir !== 'string') {
    throw new Error('project:export payload.rootDir must be a string.');
  }

  return {
    rootDir: payload.rootDir,
    project: readGeneratedProject(payload.project)
  };
}

export function registerProjectHandlers(): void {
  const specs = new BuiltInSpecRepository();
  const generator = new ProjectGenerator();

  ipcMain.handle('project:generate', (_event, payload: unknown) => {
    const input = readGenerateProjectPayload(payload);
    const spec = specs.getByChipId(input.plan.chipId);

    return generator.generate({
      projectName: input.projectName,
      requirement: input.requirement,
      plan: input.plan,
      spec
    });
  });

  ipcMain.handle('project:export', (_event, payload: unknown) => {
    const input = readExportProjectPayload(payload);
    const projectDir = exportProject(input.rootDir, input.project);

    return { projectDir };
  });
}
