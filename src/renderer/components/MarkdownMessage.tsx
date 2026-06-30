import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';

interface MarkdownMessageProps {
  text: string;
  onNormalizeCode?: (code: string) => void;
}

type ListKind = 'ordered' | 'unordered';

const COPY_CODE_LABEL = '\u590d\u5236\u4ee3\u7801';
const COPYING_LABEL = '\u590d\u5236';
const COPIED_LABEL = '\u5df2\u590d\u5236';
const COPY_FAILED_LABEL = '\u590d\u5236\u5931\u8d25';
const CLIPBOARD_TIMEOUT_MS = 1200;

export function MarkdownMessage({ text, onNormalizeCode }: MarkdownMessageProps) {
  return <div className="markdown-message">{renderBlocks(text, onNormalizeCode)}</div>;
}

function renderBlocks(text: string, onNormalizeCode?: (code: string) => void): ReactNode[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const fence = /^```([\w-]*)\s*$/.exec(trimmed);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(renderCodeBlock(codeLines.join('\n'), blocks.length, fence[1], onNormalizeCode));
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      blocks.push(renderHeading(heading[1].length, heading[2], blocks.length));
      index += 1;
      continue;
    }

    const listKind = getListKind(trimmed);
    if (listKind) {
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        const currentKind = getListKind(current);
        if (currentKind !== listKind) break;
        items.push(stripListMarker(current, listKind));
        index += 1;
      }
      blocks.push(renderList(items, listKind, blocks.length));
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (!current || /^```/.test(current) || /^(#{1,3})\s+/.test(current) || getListKind(current)) break;
      paragraphLines.push(current);
      index += 1;
    }
    blocks.push(
      <p key={`p-${blocks.length}`}>
        {renderInline(paragraphLines.join(' '))}
      </p>
    );
  }

  return blocks;
}

function renderHeading(level: number, content: string, key: number): ReactNode {
  if (level === 1) return <h1 key={`h-${key}`}>{renderInline(content)}</h1>;
  if (level === 2) return <h2 key={`h-${key}`}>{renderInline(content)}</h2>;
  return <h3 key={`h-${key}`}>{renderInline(content)}</h3>;
}

function renderCodeBlock(code: string, key: number, language: string, onNormalizeCode?: (code: string) => void): ReactNode {
  return <MarkdownCodeBlock code={code} language={language} onNormalizeCode={onNormalizeCode} key={`code-${key}`} />;
}

interface MarkdownCodeBlockProps {
  code: string;
  language: string;
  onNormalizeCode?: (code: string) => void;
}

function MarkdownCodeBlock({ code, language, onNormalizeCode }: MarkdownCodeBlockProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const resetTimerRef = useRef<number | null>(null);
  const isNormalizedAsm = isNormalizedAsmOutput(code, language);
  const canNormalize = Boolean(onNormalizeCode) && isAsmCodeBlock(code, language) && !isNormalizedAsm;

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  async function handleCopy() {
    const copyResult = copyToClipboard(code);
    const copied = typeof copyResult === 'boolean' ? copyResult : await copyResult;
    setCopyState(copied ? 'copied' : 'failed');

    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }

    resetTimerRef.current = window.setTimeout(() => {
      setCopyState('idle');
      resetTimerRef.current = null;
    }, 1600);
  }

  return (
    <div className="markdown-code-block-shell">
      <div className="markdown-code-actions">
        {isNormalizedAsm ? (
          <span className="markdown-code-normalized-badge" aria-label="已规范">
            已规范
          </span>
        ) : canNormalize ? (
          <button
            type="button"
            className="markdown-code-normalize-button"
            aria-label="规范化"
            onClick={() => onNormalizeCode?.(code)}
          >
            规范化
          </button>
        ) : null}
        <button
          type="button"
          className="markdown-code-copy-button"
          aria-label={COPY_CODE_LABEL}
          onClick={() => void handleCopy()}
        >
          {copyState === 'copied' ? COPIED_LABEL : copyState === 'failed' ? COPY_FAILED_LABEL : COPYING_LABEL}
        </button>
      </div>
      <pre className="markdown-code-block" data-language={language || undefined}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function isAsmCodeBlock(code: string, language: string): boolean {
  const normalizedLanguage = language.trim().toLowerCase();
  if (['asm', 'assembly', 's'].includes(normalizedLanguage)) return true;
  if (normalizedLanguage) return false;

  return /\b(MOV|CLRWDT|JMP|CALL|RET|DJNZ|CPL)\b/i.test(code);
}

function isNormalizedAsmOutput(code: string, language: string): boolean {
  if (!isAsmCodeBlock(code, language)) return false;

  return (
    /;\s*HK64S8x single-file ASM generated by ASM Agent\./i.test(code) &&
    /;\s*File:\s*main\.asm/i.test(code) &&
    /;\s*Static check:\s*passed built-in instruction\/register validation before display\./i.test(code)
  );
}

function copyToClipboard(text: string): boolean | Promise<boolean> {
  if (copyWithTextArea(text)) {
    return true;
  }

  if (!navigator.clipboard?.writeText) {
    return false;
  }

  return withTimeout(navigator.clipboard.writeText(text), CLIPBOARD_TIMEOUT_MS).then(
    () => true,
    () => false
  );
}

function copyWithTextArea(text: string): boolean {
  if (typeof document.execCommand !== 'function') {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  return copied;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error('Clipboard copy timed out.'));
    }, timeoutMs);

    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

function renderList(items: string[], kind: ListKind, key: number): ReactNode {
  const renderedItems = items.map((item, itemIndex) => (
    <li key={`${key}-${itemIndex}`}>{renderInline(item)}</li>
  ));

  return kind === 'ordered' ? (
    <ol key={`list-${key}`}>{renderedItems}</ol>
  ) : (
    <ul key={`list-${key}`}>{renderedItems}</ul>
  );
}

function getListKind(line: string): ListKind | null {
  if (/^\d+\.\s+/.test(line)) return 'ordered';
  if (/^[-*]\s+/.test(line)) return 'unordered';
  return null;
}

function stripListMarker(line: string, kind: ListKind): string {
  return kind === 'ordered' ? line.replace(/^\d+\.\s+/, '') : line.replace(/^[-*]\s+/, '');
}

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenPattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(text))) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `inline-${nodes.length}-${match.index}`;
    if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.map((node, index) => (
    <Fragment key={`node-${index}`}>{node}</Fragment>
  ));
}
