import { useEffect, useMemo, useState } from 'react';

import type { GeneratedProject } from '../../shared/project/ProjectTypes';

interface GeneratedProjectPanelProps {
  project: GeneratedProject | null;
}

export function GeneratedProjectPanel({ project }: GeneratedProjectPanelProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    setSelectedPath(project?.files[0]?.path ?? null);
  }, [project]);

  const selectedFile = useMemo(() => {
    if (!project) {
      return null;
    }

    return project.files.find((file) => file.path === selectedPath) ?? project.files[0] ?? null;
  }, [project, selectedPath]);

  return (
    <section className="panel project-panel" aria-label="生成工程">
      <div className="panel-kicker">工程输出</div>
      <h2>{project ? project.projectName : '等待生成'}</h2>

      {project ? (
        <div className="project-grid">
          <nav className="file-tree" aria-label="工程文件树">
            {project.files.map((file) => (
              <button
                className={file.path === selectedFile?.path ? 'file-node active' : 'file-node'}
                key={file.path}
                type="button"
                onClick={() => setSelectedPath(file.path)}
              >
                {file.path}
              </button>
            ))}
          </nav>
          <div className="code-preview">
            <div className="code-title">{selectedFile?.path}</div>
            <pre>{selectedFile?.content}</pre>
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <strong>工程文件将在这里出现</strong>
          <span>生成计划后可生成 ASM 工程文件与代码预览。</span>
        </div>
      )}
    </section>
  );
}
