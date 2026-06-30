import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

const appCss = readFileSync(resolve('src/renderer/styles/app.css'), 'utf8');
const tokensCss = readFileSync(resolve('src/renderer/styles/tokens.css'), 'utf8');

function installAppStyles() {
  const style = document.createElement('style');
  style.dataset.testStyle = 'app-css';
  style.textContent = `${tokensCss}\n${appCss}`;
  document.head.appendChild(style);
}

function renderChatLayout() {
  document.body.innerHTML = `
    <main class="app-shell">
      <aside class="panel workspace-sidebar">
        <nav class="conversation-list"></nav>
      </aside>
      <div class="sidebar-resizer"></div>
      <section class="panel assistant-panel">
        <div class="assistant-heading"></div>
        <div class="workflow-bar"></div>
        <div class="message-list"></div>
        <form class="requirement-form agent-composer">
          <label class="sr-only" for="asm-requirement">ASM 功能需求</label>
          <textarea id="asm-requirement" placeholder="描述 ASM 需求或后续变更"></textarea>
          <div class="composer-footer">
            <div class="composer-tools">
              <div class="model-picker-wrap">
                <button class="model-picker" type="button" aria-label="选择模型" aria-expanded="true" aria-haspopup="listbox">
                  <span class="model-picker-label">模型</span>
                  <span class="model-picker-display">ASM 工程生成器 v2.0</span>
                </button>
                <div class="model-picker-menu" role="listbox" aria-label="选择模型">
                  <button class="model-picker-option selected" type="button" role="option" aria-selected="true">本地规则引擎</button>
                </div>
              </div>
              <button class="composer-tool" type="button">
                <span class="composer-tool-icon clip"></span>
                上传文件
              </button>
              <button class="composer-tool" type="button">
                <span class="composer-tool-icon doc"></span>
                添加参考
              </button>
              <button class="composer-tool" type="button">
                <span class="composer-tool-icon book"></span>
                指令集
              </button>
            </div>
            <div class="composer-actions">
              <button class="send-button" type="submit">
                <img class="send-glyph" src="icons/21_send_reference.png" alt="" aria-hidden="true" />
              </button>
              <button class="send-button disabled-preview" type="submit" disabled>
                <img class="send-glyph" src="icons/21_send_reference.png" alt="" aria-hidden="true" />
              </button>
            </div>
          </div>
        </form>
        <section class="plan-summary"></section>
      </section>
      <div class="output-resizer"></div>
      <aside class="panel output-panel">
        <section class="output-card"></section>
        <section class="output-section"></section>
      </aside>
    </main>
  `;

  return {
    shell: document.querySelector<HTMLElement>('.app-shell'),
    sidebar: document.querySelector<HTMLElement>('.workspace-sidebar'),
    resizer: document.querySelector<HTMLElement>('.sidebar-resizer'),
    outputResizer: document.querySelector<HTMLElement>('.output-resizer'),
    assistant: document.querySelector<HTMLElement>('.assistant-panel'),
    messages: document.querySelector<HTMLElement>('.message-list'),
    outputPanel: document.querySelector<HTMLElement>('.output-panel')
  };
}

function expectZeroCssLength(value: string) {
  expect(['0', '0px']).toContain(value);
}

function expectResolvedColor(value: string, cssVariable: string, resolvedRgb: string) {
  expect([cssVariable, resolvedRgb]).toContain(value);
}

describe('chat layout scrolling', () => {
  afterEach(() => {
    document.head.querySelectorAll('[data-test-style="app-css"]').forEach((node) => node.remove());
    document.body.innerHTML = '';
  });

  it('keeps the desktop app shell fixed while the chat history scrolls inside the assistant panel', () => {
    installAppStyles();
    const { shell, sidebar, resizer, outputResizer, assistant, messages, outputPanel } = renderChatLayout();

    expect(shell).not.toBeNull();
    expect(sidebar).not.toBeNull();
    expect(resizer).not.toBeNull();
    expect(outputResizer).not.toBeNull();
    expect(assistant).not.toBeNull();
    expect(messages).not.toBeNull();
    expect(outputPanel).not.toBeNull();

    const shellStyle = getComputedStyle(shell as HTMLElement);
    const sidebarStyle = getComputedStyle(sidebar as HTMLElement);
    const resizerStyle = getComputedStyle(resizer as HTMLElement);
    const outputResizerStyle = getComputedStyle(outputResizer as HTMLElement);
    const assistantStyle = getComputedStyle(assistant as HTMLElement);
    const messageStyle = getComputedStyle(messages as HTMLElement);
    const outputStyle = getComputedStyle(outputPanel as HTMLElement);

    expect(shellStyle.height).toBe('100vh');
    expect(shellStyle.overflow).toBe('hidden');
    expect(shellStyle.gridTemplateColumns).toBe(
      'minmax(0, var(--sidebar-width, 260px)) 8px minmax(0, 1fr) 8px minmax(0, var(--output-panel-width, 320px))'
    );
    expect(shellStyle.gridTemplateRows).toBe('minmax(0, 1fr)');
    expect(sidebarStyle.height).toBe('100%');
    expect(sidebarStyle.overflow).toBe('hidden');
    expect(resizerStyle.cursor).toBe('col-resize');
    expect(outputResizerStyle.cursor).toBe('col-resize');
    expect(assistantStyle.height).toBe('100%');
    expectZeroCssLength(assistantStyle.minHeight);
    expect(assistantStyle.paddingLeft).toBe('40px');
    expect(assistantStyle.paddingRight).toBe('40px');
    expect(assistantStyle.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(assistantStyle.gridTemplateRows).toBe('auto minmax(0, 1fr) auto');
    expectZeroCssLength(messageStyle.minHeight);
    expect(messageStyle.overflowY).toBe('auto');
    expect(outputStyle.display).toBe('flex');
    expect(outputStyle.height).toBe('100%');
    expect(outputStyle.overflowY).toBe('auto');
  });

  it('keeps resize handles above panels and prevents panel hit-testing while dragging', () => {
    installAppStyles();
    const { shell, resizer, outputResizer, assistant, outputPanel } = renderChatLayout();

    expect(shell).not.toBeNull();
    expect(resizer).not.toBeNull();
    expect(outputResizer).not.toBeNull();
    expect(assistant).not.toBeNull();
    expect(outputPanel).not.toBeNull();

    const resizerStyle = getComputedStyle(resizer as HTMLElement);
    const outputResizerStyle = getComputedStyle(outputResizer as HTMLElement);
    const assistantStyle = getComputedStyle(assistant as HTMLElement);
    const outputStyle = getComputedStyle(outputPanel as HTMLElement);

    expect(resizerStyle.position).toBe('relative');
    expect(outputResizerStyle.position).toBe('relative');
    expect(Number(outputResizerStyle.zIndex)).toBeGreaterThan(Number(outputStyle.zIndex));
    expectZeroCssLength(assistantStyle.minWidth);
    expectZeroCssLength(outputStyle.minWidth);

    (shell as HTMLElement).className = 'app-shell resizing resizing-output';

    const resizingShellStyle = getComputedStyle(shell as HTMLElement);
    const resizingAssistantStyle = getComputedStyle(assistant as HTMLElement);
    const resizingOutputStyle = getComputedStyle(outputPanel as HTMLElement);

    expect(resizingShellStyle.cursor).toBe('col-resize');
    expect(resizingShellStyle.userSelect).toBe('none');
    expect(resizingAssistantStyle.pointerEvents).toBe('none');
    expect(resizingOutputStyle.pointerEvents).toBe('none');
  });

  it('keeps simplified topbar controls compact without clipping out of the center panel', () => {
    installAppStyles();
    document.body.innerHTML = `
      <header class="chat-topbar">
        <nav class="chat-breadcrumb" aria-label="位置">
          <span class="crumb">首页</span>
          <span class="crumb-sep">/</span>
          <span class="crumb current">自然语言到 ASM 工程</span>
        </nav>
        <div class="chat-topbar-actions">
          <div class="topbar-utility-actions">
            <span class="topbar-version">v0.0.3</span>
          </div>
        </div>
      </header>
    `;

    const topbarStyle = getComputedStyle(document.querySelector('.chat-topbar') as HTMLElement);
    const breadcrumbStyle = getComputedStyle(document.querySelector('.chat-breadcrumb') as HTMLElement);
    const actionsStyle = getComputedStyle(document.querySelector('.chat-topbar-actions') as HTMLElement);
    const utilityActionsStyle = getComputedStyle(document.querySelector('.topbar-utility-actions') as HTMLElement);

    expect(document.querySelector('.topbar-model')).toBeNull();
    expect(document.querySelector('.topbar-workspace')).toBeNull();
    expect(document.querySelector('.topbar-primary-actions')).toBeNull();
    expect(topbarStyle.flexWrap).toBe('nowrap');
    expect(breadcrumbStyle.whiteSpace).toBe('nowrap');
    expect(actionsStyle.flexGrow).toBe('0');
    expect(actionsStyle.flexWrap).toBe('nowrap');
    expect(utilityActionsStyle.borderLeftStyle).not.toBe('solid');
  });

  it('keeps code block controls inside the visible message width when code lines are long', () => {
    installAppStyles();
    document.body.innerHTML = `
      <article class="message-bubble assistant">
        <div class="message-content">
          <div class="markdown-message">
            <div class="markdown-code-block-shell">
              <button class="markdown-code-copy-button" type="button">复制</button>
              <pre class="markdown-code-block"><code>; very long generated asm line that should scroll inside the pre element instead of widening the shell</code></pre>
            </div>
          </div>
        </div>
      </article>
    `;

    const contentStyle = getComputedStyle(document.querySelector('.message-content') as HTMLElement);
    const shellStyle = getComputedStyle(document.querySelector('.markdown-code-block-shell') as HTMLElement);
    const preStyle = getComputedStyle(document.querySelector('.markdown-code-block') as HTMLElement);

    expectZeroCssLength(contentStyle.minWidth);
    expect(shellStyle.width).toBe('100%');
    expectZeroCssLength(shellStyle.minWidth);
    expect(shellStyle.overflow).toBe('hidden');
    expect(preStyle.width).toBe('100%');
    expect(preStyle.boxSizing).toBe('border-box');
    expect(preStyle.overflowX).toBe('auto');
  });

  it('renders conversation turns as a Codex-style chat stream', () => {
    installAppStyles();
    document.body.innerHTML = `
      <div class="message-list">
        <article class="message-bubble user">
          <span>User</span>
          <p>Configure PA1 as an external interrupt input.</p>
        </article>
        <article class="message-bubble assistant">
          <span>Assistant</span>
          <div class="message-content">
            <div class="markdown-message">
              <p>I will generate main.asm with HK64S8x rules.</p>
            </div>
          </div>
        </article>
        <article class="trace-bubble" aria-label="智能体执行过程">
          <div class="agent-trace">
            <div class="trace-narration">
              <span>收到需求后，按 HK64S8x ASM 工程生成任务来处理。</span>
            </div>
            <details class="trace-tool-group">
              <summary class="trace-tg-head">Ran 1 command</summary>
            </details>
            <div class="trace-action">
              <span class="trace-action-title">正在校验寄存器和中断入口。</span>
            </div>
            <div class="trace-edit">
              <span>编辑 main.asm。</span>
            </div>
          </div>
        </article>
      </div>
    `;

    const userStyle = getComputedStyle(document.querySelector('.message-bubble.user') as HTMLElement);
    const userLabelStyle = getComputedStyle(document.querySelector('.message-bubble.user > span') as HTMLElement);
    const userTextStyle = getComputedStyle(document.querySelector('.message-bubble.user p') as HTMLElement);
    const assistantStyle = getComputedStyle(document.querySelector('.message-bubble.assistant') as HTMLElement);
    const traceStyle = getComputedStyle(document.querySelector('.trace-bubble') as HTMLElement);
    const traceNarrationStyle = getComputedStyle(document.querySelector('.trace-narration') as HTMLElement);
    const traceActionStyle = getComputedStyle(document.querySelector('.trace-action') as HTMLElement);
    const traceActionTitleStyle = getComputedStyle(document.querySelector('.trace-action-title') as HTMLElement);
    const traceEditStyle = getComputedStyle(document.querySelector('.trace-edit') as HTMLElement);

    expect(userStyle.alignSelf).toBe('flex-end');
    expect(userStyle.width).toBe('fit-content');
    expect(userStyle.borderTopWidth).toBe('0px');
    expect(userStyle.backgroundColor).toBe('rgb(241, 244, 248)');
    expect(userStyle.boxShadow).toBe('none');
    expect(userStyle.color).not.toBe('rgb(255, 255, 255)');
    expect(userLabelStyle.position).toBe('absolute');
    expect(userLabelStyle.width).toBe('1px');
    expectResolvedColor(userTextStyle.color, 'var(--text-primary)', 'rgb(19, 28, 46)');
    expect(userTextStyle.fontWeight).toBe('500');

    expect(assistantStyle.alignSelf).toBe('flex-start');
    expect(assistantStyle.borderTopWidth).toBe('0px');
    expect(assistantStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(assistantStyle.boxShadow).toBe('none');

    expect(traceStyle.alignSelf).toBe('flex-start');
    expect(traceStyle.borderTopWidth).toBe('0px');
    expect(traceStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(traceStyle.boxShadow).toBe('none');
    expectResolvedColor(traceStyle.color, 'var(--text-primary)', 'rgb(19, 28, 46)');
    expect(traceNarrationStyle.fontSize).toBe('14px');
    expectResolvedColor(traceNarrationStyle.color, 'var(--text-primary)', 'rgb(19, 28, 46)');
    expect(traceActionStyle.fontSize).toBe('14px');
    expectResolvedColor(traceActionStyle.color, 'var(--text-primary)', 'rgb(19, 28, 46)');
    expect(traceActionTitleStyle.fontWeight).toBe('400');
    expectResolvedColor(traceActionTitleStyle.color, 'var(--text-primary)', 'rgb(19, 28, 46)');
    expect(traceEditStyle.fontSize).toBe('14px');
    expectResolvedColor(traceEditStyle.color, 'var(--text-primary)', 'rgb(19, 28, 46)');
  });

  it('uses a codex-style composer without a visible prompt label', () => {
    installAppStyles();
    renderChatLayout();

    const labelStyle = getComputedStyle(document.querySelector('.sr-only') as HTMLElement);
    const formStyle = getComputedStyle(document.querySelector('.requirement-form') as HTMLElement);
    const textareaStyle = getComputedStyle(document.querySelector('textarea') as HTMLElement);
    const sendButtonStyle = getComputedStyle(document.querySelector('.send-button:not(.disabled-preview)') as HTMLElement);
    const disabledButtonStyle = getComputedStyle(document.querySelector('.send-button.disabled-preview') as HTMLElement);
    const sendGlyph = document.querySelector('.send-glyph') as HTMLImageElement;
    const sendGlyphStyle = getComputedStyle(sendGlyph);
    const disabledGlyphStyle = getComputedStyle(document.querySelector('.disabled-preview .send-glyph') as HTMLElement);

    expect(labelStyle.position).toBe('absolute');
    expect(labelStyle.width).toBe('1px');
    expect(formStyle.borderRadius).toBe('24px');
    expect(formStyle.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(formStyle.boxShadow).not.toContain('214, 38, 47');
    expect(formStyle.boxShadow).not.toContain('inset');
    expect(textareaStyle.borderTopWidth).toBe('0px');
    expectResolvedColor(textareaStyle.color, 'var(--text-primary)', 'rgb(19, 28, 46)');
    expectResolvedColor(textareaStyle.caretColor, 'var(--accent)', 'rgb(27, 98, 232)');
    expect(textareaStyle.resize).toBe('none');
    expect(sendButtonStyle.width).toBe('42px');
    expect(sendButtonStyle.height).toBe('42px');
    expect(sendButtonStyle.borderRadius).toBe('14px');
    expect(sendButtonStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(disabledButtonStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(disabledButtonStyle.opacity).toBe('1');
    expect(sendGlyphStyle.width).toBe('42px');
    expect(sendGlyphStyle.height).toBe('42px');
    expect(sendGlyph.tagName).toBe('IMG');
    expect(sendGlyph.getAttribute('src')).toBe('icons/21_send_reference.png');
    expect(sendGlyphStyle.objectFit).toBe('cover');
    expect(sendGlyphStyle.transform).toContain('scale');
    expect(disabledGlyphStyle.opacity).toBe('0.55');
  });

  it('recreates the reference-style composer toolbar with a model pill and light tool buttons', () => {
    installAppStyles();
    renderChatLayout();

    const toolsStyle = getComputedStyle(document.querySelector('.composer-tools') as HTMLElement);
    const pickerWrapStyle = getComputedStyle(document.querySelector('.model-picker-wrap') as HTMLElement);
    const pickerStyle = getComputedStyle(document.querySelector('.model-picker') as HTMLElement);
    const displayStyle = getComputedStyle(document.querySelector('.model-picker-display') as HTMLElement);
    const menuStyle = getComputedStyle(document.querySelector('.model-picker-menu') as HTMLElement);
    const optionStyle = getComputedStyle(document.querySelector('.model-picker-option') as HTMLElement);
    const toolStyle = getComputedStyle(document.querySelector('.composer-tool') as HTMLElement);
    const iconStyle = getComputedStyle(document.querySelector('.composer-tool-icon') as HTMLElement);

    expect(toolsStyle.display).toBe('inline-flex');
    expect(toolsStyle.flexWrap).toBe('nowrap');
    expect(toolsStyle.gap).toBe('8px');
    expect(pickerWrapStyle.position).toBe('relative');
    expect(pickerStyle.minHeight).toBe('38px');
    expect(pickerStyle.borderTopWidth).toBe('1px');
    expect(pickerStyle.borderRadius).toBe('999px');
    expect(pickerStyle.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(displayStyle.fontWeight).toBe('700');
    expect(menuStyle.position).toBe('absolute');
    expect(menuStyle.borderRadius).toBe('18px');
    expect(optionStyle.borderRadius).toBe('12px');
    expect(toolStyle.minHeight).toBe('38px');
    expect(toolStyle.borderRadius).toBe('999px');
    expect(toolStyle.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(iconStyle.width).toBe('16px');
    expect(iconStyle.height).toBe('16px');
  });

  it('keeps generated output file controls constrained inside a narrow output panel', () => {
    installAppStyles();
    document.body.innerHTML = `
      <aside class="panel output-panel" style="width: 260px;">
        <section class="output-card">
          <div class="output-card-head">
            <span class="output-card-title">Project output preview</span>
          </div>
          <div class="output-file">
            <div class="output-file-row">
              <span class="output-file-icon" aria-hidden="true"></span>
              <div class="output-file-meta">
                <strong>main.asm</strong>
                <span class="output-file-path">C:\\Users\\Admin\\Documents\\ASM Agent\\output\\sessions\\session-17818\\main.asm</span>
                <span>548 B · 29 lines</span>
              </div>
              <span class="output-status-pill">Done</span>
            </div>
            <p class="output-file-updated">Updated just now</p>
            <button class="output-open-button" type="button">
              <span>Open file</span>
              <span class="output-open-icon" aria-hidden="true"></span>
            </button>
          </div>
        </section>
      </aside>
    `;

    const panelStyle = getComputedStyle(document.querySelector('.output-panel') as HTMLElement);
    const cardStyle = getComputedStyle(document.querySelector('.output-card') as HTMLElement);
    const fileStyle = getComputedStyle(document.querySelector('.output-file') as HTMLElement);
    const rowStyle = getComputedStyle(document.querySelector('.output-file-row') as HTMLElement);
    const buttonStyle = getComputedStyle(document.querySelector('.output-open-button') as HTMLElement);

    expect(panelStyle.overflowX).toBe('hidden');
    expectZeroCssLength(cardStyle.minWidth);
    expectZeroCssLength(fileStyle.minWidth);
    expect(fileStyle.overflow).toBe('hidden');
    expectZeroCssLength(rowStyle.minWidth);
    expect(rowStyle.width).toBe('100%');
    expect(rowStyle.maxWidth).toBe('100%');
    expectZeroCssLength(buttonStyle.minWidth);
    expect(buttonStyle.maxWidth).toBe('100%');
  });
});
