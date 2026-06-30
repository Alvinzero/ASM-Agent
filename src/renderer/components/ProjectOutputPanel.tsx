import { useMemo } from 'react';

import type { AgentSessionState } from '../state/useAgentSession';

interface ProjectOutputPanelProps {
  session: AgentSessionState;
}

const PROJECT_INFO: Array<{ label: string; value: string }> = [
  { label: '目标芯片', value: 'HK64S8x' },
  { label: '架构', value: '8-bit RISC' },
  { label: '汇编器', value: 'ASMC v2.5' },
  { label: '优化等级', value: '优化级别 -O2' }
];

const CHECKLIST_ITEMS = ['语法检查', '指令集合规', '寄存器使用', '中断向量表', '栈使用检查', '代码大小'];

function OpenExternalGlyph() {
  return (
    <svg
      className="output-open-glyph"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.35"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      <path d="M15 3h6v6M21 3l-9.5 9.5" />
      <path d="M10 5H6.75A2.75 2.75 0 0 0 4 7.75v9.5A2.75 2.75 0 0 0 6.75 20h9.5A2.75 2.75 0 0 0 19 17.25V14" />
    </svg>
  );
}

function formatRelativeTime(timestamp: number): string {
  const deltaSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (deltaSeconds < 30) return '刚刚';
  if (deltaSeconds < 60) return `${deltaSeconds} 秒前`;
  const deltaMinutes = Math.round(deltaSeconds / 60);
  if (deltaMinutes < 60) return `${deltaMinutes} 分钟前`;
  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours} 小时前`;
  return `${Math.round(deltaHours / 24)} 天前`;
}

export function ProjectOutputPanel({ session }: ProjectOutputPanelProps) {
  const asmFile = session.asmFile;
  const isValidated = session.normalizationStatus === 'validated' || asmFile !== null;

  const updatedLabel = useMemo(() => (asmFile ? formatRelativeTime(asmFile.generatedAt) : null), [asmFile]);

  return (
    <aside className="panel output-panel" aria-label="工程输出">
      <section className="output-card">
        <div className="output-card-head">
          <span className="output-card-title">工程输出预览</span>
        </div>

        {asmFile ? (
          <div className="output-file">
            <div className="output-file-row">
              <span className="output-file-icon" aria-hidden="true">
                <img src="icons/11_file_asm_icon.svg" alt="" />
              </span>
              <div className="output-file-meta">
                <strong>{asmFile.path}</strong>
                {asmFile.absolutePath ? (
                  <span className="output-file-path" title={asmFile.absolutePath}>
                    {asmFile.absolutePath}
                  </span>
                ) : null}
                <span>
                  {asmFile.sizeLabel} · {asmFile.lineCount} 行
                </span>
              </div>
              <span className="output-status-pill">生成完成</span>
            </div>
            <p className="output-file-updated">更新于 {updatedLabel}</p>
            <button
              className="output-open-button"
              type="button"
              disabled={!asmFile.absolutePath}
              onClick={() => void session.openAsmFile()}
            >
              <span>打开文件所在位置</span>
              <span className="output-open-icon" aria-hidden="true">
                <OpenExternalGlyph />
              </span>
            </button>
          </div>
        ) : (
          <div className="output-empty">
            <span className="output-empty-icon" aria-hidden="true">
              <img src="icons/11_file_asm_icon.svg" alt="" />
            </span>
            <strong>暂无生成文件</strong>
            <span>描述需求并完成规范化后，这里会显示 main.asm 输出。</span>
          </div>
        )}
      </section>

      <section className="output-section">
        <div className="output-section-title">工程信息</div>
        <dl className="output-info-list">
          {PROJECT_INFO.map((item) => (
            <div className="output-info-row" key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
          <div className="output-info-row">
            <dt>生成时间</dt>
            <dd>{updatedLabel ?? '尚未生成'}</dd>
          </div>
        </dl>
        <button className="output-link-button" type="button">
          查看详情
        </button>
      </section>

      <section className="output-section">
        <div className="output-section-title">工程检查清单</div>
        <ul className="output-checklist" aria-label="工程检查清单">
          {CHECKLIST_ITEMS.map((item) => (
            <li className={`output-check-item${isValidated ? ' passed' : ''}`} key={item}>
              <span className="output-check-label">{item}</span>
              <span className="output-check-state" aria-hidden="true">
                {isValidated ? (
                  <>
                    <span className="output-check-mark" />
                    通过
                  </>
                ) : (
                  '待生成'
                )}
              </span>
            </li>
          ))}
        </ul>
        <button className="output-link-button" type="button">
          查看完整报告
        </button>
      </section>
    </aside>
  );
}
