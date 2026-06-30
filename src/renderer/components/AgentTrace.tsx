import type { ReactNode } from 'react';

import type { TraceNode } from '../state/useAgentSession';

interface AgentTraceProps {
  nodes: TraceNode[];
}

/** convert `code` inline marker to <code> */
function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      return (
        <code className="trace-inline-code" key={index}>
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

function NarrationNode({ node }: { node: TraceNode }) {
  const revealed = node.revealed ?? node.text.length;
  const shown = node.text.slice(0, revealed);
  return (
    <div className="trace-narration">
      <span>{renderInline(shown)}</span>
      {node.status === 'running' ? <span className="trace-cursor" aria-hidden="true" /> : null}
    </div>
  );
}

function CommandsNode({ node }: { node: TraceNode }) {
  const commands = node.commands ?? [];
  const running = node.status === 'running';
  const commandCount = commands.length;
  const title = commandCount > 0 && !node.text.includes('条命令') ? `${node.text} ${commandCount} 条命令` : node.text;

  return (
    <details className={`trace-tool-group${running ? ' running' : ''}`} open={running || undefined}>
      <summary
        className="trace-tg-head"
      >
        <span className="trace-tg-ico" aria-hidden="true">
          {running ? <span className="trace-spinner" /> : <span className="trace-check">✓</span>}
        </span>
        <span className="trace-tg-title">{title}</span>
        <span className="trace-tg-chevron" aria-hidden="true" />
      </summary>
      <div className="trace-tg-body">
        {commands.map((command, index) => (
          <div className="trace-cmd" key={index}>
            <span className={`trace-cmd-mark${command.status === 'done' ? ' done' : ''}`} aria-hidden="true">
              {command.status === 'done' ? '✓' : <span className="trace-spinner sm" />}
            </span>
            <span className="trace-cmd-text">
              {command.text}
              {command.result ? <span className="trace-cmd-res">{' -> '}{command.result}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

function ReasoningNode({ node }: { node: TraceNode }) {
  const running = node.status === 'running';
  return (
    <details className={`trace-reasoning${running ? ' running' : ''}`} open={running || undefined}>
      <summary className="trace-reasoning-head">
        <span className="trace-reasoning-ico" aria-hidden="true">
          {running ? <span className="trace-spinner" /> : <span className="trace-check">✓</span>}
        </span>
        <span className="trace-reasoning-title">{running ? '模型正在思考' : '模型思考'}</span>
        <span className="trace-tg-chevron" aria-hidden="true" />
      </summary>
      <div className="trace-reasoning-body">
        {node.text}
        {running ? <span className="trace-cursor" aria-hidden="true" /> : null}
      </div>
    </details>
  );
}

function ActionNode({ node }: { node: TraceNode }) {
  const running = node.status === 'running';
  return (
    <div className={`trace-action${running ? ' running' : ''}`}>
      <span className="trace-action-ico" aria-hidden="true">
        {running ? <span className="trace-spinner" /> : <span className="trace-check">✓</span>}
      </span>
      <span className="trace-action-title">{node.text}</span>
      {node.result ? <span className="trace-action-res">{node.result}</span> : null}
    </div>
  );
}

function EditNode({ node }: { node: TraceNode }) {
  return (
    <div className="trace-edit">
      <span className="trace-edit-ico" aria-hidden="true">
        ✎
      </span>
      <span>{node.text}</span>
    </div>
  );
}

export function AgentTrace({ nodes }: AgentTraceProps) {
  return (
    <div className="agent-trace">
      {nodes.map((node) => {
        if (node.type === 'narration') return <NarrationNode node={node} key={node.id} />;
        if (node.type === 'commands') return <CommandsNode node={node} key={node.id} />;
        if (node.type === 'reasoning') return <ReasoningNode node={node} key={node.id} />;
        if (node.type === 'action') return <ActionNode node={node} key={node.id} />;
        return <EditNode node={node} key={node.id} />;
      })}
    </div>
  );
}
