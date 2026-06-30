import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../../src/renderer/App';

const appCss = readFileSync(resolve('src/renderer/styles/app.css'), 'utf8');
const tokensCss = readFileSync(resolve('src/renderer/styles/tokens.css'), 'utf8');

function installAppStyles() {
  const style = document.createElement('style');
  style.dataset.testStyle = 'app-css';
  style.textContent = `${tokensCss}\n${appCss}`;
  document.head.appendChild(style);
}

async function advanceTimers(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function advanceLocalGeneration() {
  await advanceTimers(18000);
}

const externalModelWait = { timeout: 5000 };

async function flushAuthCheck() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

function expectPlanningTraceStarted() {
  const traceText = document.querySelector('.agent-trace')?.textContent ?? '';
  expect(traceText).toContain('收到需求');
  expect(traceText).toContain('任务上下文');
}

type AuthApiTestStub = NonNullable<typeof window.asmAgent> & {
  getCurrentUser: ReturnType<typeof vi.fn>;
  loginUser: ReturnType<typeof vi.fn>;
  registerUser: ReturnType<typeof vi.fn>;
  logoutUser: ReturnType<typeof vi.fn>;
};

function getAuthApi(): AuthApiTestStub {
  return window.asmAgent as unknown as AuthApiTestStub;
}

async function findWorkspaceShell(): Promise<HTMLElement> {
  await flushAuthCheck();
  expect(screen.getByLabelText('ASM Agent 导航')).toBeInTheDocument();
  const shell = document.querySelector('.app-shell') as HTMLElement | null;
  expect(shell).not.toBeNull();
  return shell as HTMLElement;
}

async function renderAuthenticatedApp(): Promise<HTMLElement> {
  render(<App />);
  return findWorkspaceShell();
}

function setMessageListScrollMetrics(list: HTMLElement, metrics: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  Object.defineProperty(list, 'scrollHeight', {
    configurable: true,
    value: metrics.scrollHeight
  });
  Object.defineProperty(list, 'clientHeight', {
    configurable: true,
    value: metrics.clientHeight
  });
  list.scrollTop = metrics.scrollTop;
}

describe('assistant flow', () => {
  beforeEach(() => {
    window.localStorage.clear();
    const asmAgent = {
      version: '0.1.0',
      createPlan: vi.fn().mockResolvedValue({
        status: 'ready',
        plan: {
          summary: '生成 Timer0 + GPIO ASM 工程',
          chipId: 'HK64S8x',
          features: ['Timer0', 'GPIO'],
          files: ['startup/reset.asm', 'src/main.asm'],
          usesInterrupt: true,
          requiredRegisters: ['T0_PS', 'PA_PIO'],
          assumptions: ['使用内置规范库']
        }
      }),
      generateProject: vi.fn().mockResolvedValue({
        projectName: 'timer0-pa0-demo',
        files: [
          {
            path: 'src/main.asm',
            content: 'main_loop:\n  CLRWDT\n  JMP main_loop\n'
          }
        ]
      }),
      saveAsmFile: vi.fn(async ({ sessionId, file }) => ({
        path: file.path,
        absolutePath: `C:\\ASM Agent Sessions\\${sessionId}\\${file.path}`,
        sessionDir: `C:\\ASM Agent Sessions\\${sessionId}`
      })),
      openFile: vi.fn().mockResolvedValue({ ok: true }),
      completeChat: vi.fn().mockResolvedValue('来自第三方模型的动态回答'),
      getCurrentUser: vi.fn().mockResolvedValue({
        account: 'admin',
        name: 'Admin',
        role: 'ASM 工程师'
      }),
      loginUser: vi.fn().mockResolvedValue({
        account: 'ligong',
        name: '李工',
        role: '固件开发工程师'
      }),
      registerUser: vi.fn(async (payload: { account: string; name: string; role: string }) => ({
        account: payload.account,
        name: payload.name,
        role: payload.role
      })),
      logoutUser: vi.fn().mockResolvedValue({ ok: true })
    };

    vi.stubGlobal('asmAgent', asmAgent);
    Object.defineProperty(window, 'asmAgent', {
      configurable: true,
      value: asmAgent
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.head.querySelectorAll('[data-test-style="app-css"]').forEach((node) => node.remove());
  });

  it('blocks the workspace behind a standalone login page before authentication', async () => {
    getAuthApi().getCurrentUser.mockResolvedValueOnce(null);

    render(<App />);

    expect(await screen.findByRole('heading', { name: '登录 ASM Agent' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: '用户登录' })).toBeInTheDocument();
    expect(screen.getByLabelText('登录账号')).toBeInTheDocument();
    expect(screen.getByLabelText('登录密码')).toBeInTheDocument();
    expect(screen.queryByLabelText('ASM Agent 导航')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('ASM 功能需求')).not.toBeInTheDocument();
  });

  it('opens the workspace after logging in from the standalone login page', async () => {
    getAuthApi().getCurrentUser.mockResolvedValueOnce(null);

    render(<App />);

    await screen.findByRole('heading', { name: '登录 ASM Agent' });
    const loginPage = screen.getByRole('main', { name: '用户登录' });
    fireEvent.change(within(loginPage).getByLabelText('登录账号'), { target: { value: 'ligong' } });
    fireEvent.change(within(loginPage).getByLabelText('登录密码'), { target: { value: 'secret123' } });
    fireEvent.click(within(loginPage).getByRole('button', { name: '登录' }));

    await waitFor(() => expect(screen.queryByRole('main', { name: '用户登录' })).not.toBeInTheDocument());
    expect(getAuthApi().loginUser).toHaveBeenCalledWith({
      account: 'ligong',
      password: 'secret123'
    });
    const userInfo = screen.getByRole('region', { name: '当前用户信息' });
    expect(userInfo).toHaveTextContent('李工');
    expect(userInfo).toHaveTextContent('固件开发工程师');
    expect(screen.getByLabelText('ASM Agent 导航')).toBeInTheDocument();
  });

  it('registers a new user from the standalone login page before opening the workspace', async () => {
    getAuthApi().getCurrentUser.mockResolvedValueOnce(null);

    render(<App />);

    await screen.findByRole('heading', { name: '登录 ASM Agent' });
    const loginPage = screen.getByRole('main', { name: '用户登录' });
    fireEvent.click(within(loginPage).getByRole('button', { name: '注册' }));
    fireEvent.change(within(loginPage).getByLabelText('登录账号'), { target: { value: 'zhangsan' } });
    fireEvent.change(within(loginPage).getByLabelText('姓名'), { target: { value: '张三' } });
    fireEvent.change(within(loginPage).getByLabelText('岗位'), { target: { value: '应用工程师' } });
    fireEvent.change(within(loginPage).getByLabelText('设置密码'), { target: { value: 'secret123' } });
    fireEvent.click(within(loginPage).getByRole('button', { name: '完成注册' }));

    await waitFor(() =>
      expect(getAuthApi().registerUser).toHaveBeenCalledWith({
        account: 'zhangsan',
        name: '张三',
        role: '应用工程师',
        password: 'secret123'
      })
    );
    expect(screen.queryByRole('main', { name: '用户登录' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: '当前用户信息' })).toHaveTextContent('张三');
    expect(window.localStorage.getItem('asm-agent-user-profile')).toBeNull();
  });

  it('keeps unauthenticated users on the standalone login page when login fails', async () => {
    getAuthApi().getCurrentUser.mockResolvedValueOnce(null);
    getAuthApi().loginUser.mockRejectedValueOnce(new Error('账号或密码不正确'));

    render(<App />);

    await screen.findByRole('heading', { name: '登录 ASM Agent' });
    const loginPage = screen.getByRole('main', { name: '用户登录' });
    fireEvent.change(within(loginPage).getByLabelText('登录账号'), { target: { value: 'missing' } });
    fireEvent.change(within(loginPage).getByLabelText('登录密码'), { target: { value: 'bad-password' } });
    fireEvent.click(within(loginPage).getByRole('button', { name: '登录' }));

    expect(await within(loginPage).findByText('账号或密码不正确')).toBeInTheDocument();
    expect(screen.getByRole('main', { name: '用户登录' })).toBeInTheDocument();
    expect(screen.queryByLabelText('ASM Agent 导航')).not.toBeInTheDocument();
  });

  it('logs out from settings and returns to the standalone login page', async () => {
    await renderAuthenticatedApp();

    await screen.findByLabelText('ASM Agent 导航');
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    const dialog = screen.getByRole('dialog', { name: '设置' });
    fireEvent.click(within(dialog).getByRole('button', { name: '退出登录' }));

    await waitFor(() => expect(getAuthApi().logoutUser).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('main', { name: '用户登录' })).toBeInTheDocument();
    expect(screen.queryByLabelText('ASM Agent 导航')).not.toBeInTheDocument();
  });

  it('creates a plan from natural language requirements for HK64S8x', async () => {
    vi.useFakeTimers();
    await renderAuthenticatedApp();

    const requirement = screen.getByLabelText('ASM 功能需求');
    fireEvent.change(requirement, { target: { value: '使用 Timer0 周期中断翻转 PA0 输出' } });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    await advanceLocalGeneration();

    expect(screen.getAllByText(/main\.asm/).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('计划摘要')).not.toBeInTheDocument();
    expect(screen.getAllByText('HK64S8x').length).toBeGreaterThan(0);
    expect(window.asmAgent?.createPlan).toHaveBeenCalledWith({
      chipId: 'HK64S8x',
      requirement: '使用 Timer0 周期中断翻转 PA0 输出'
    });
  });

  it('clears the composer after sending a requirement while keeping the generated output', async () => {
    vi.useFakeTimers();
    await renderAuthenticatedApp();

    const requirement = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(requirement, { target: { value: 'Generate HK64S8x GPIO project.' } });
    fireEvent.keyDown(requirement, { key: 'Enter', code: 'Enter' });

    expect(requirement).toHaveValue('');

    await advanceLocalGeneration();
    expect(screen.getAllByText(/main\.asm/).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('计划摘要')).not.toBeInTheDocument();
    expect(window.asmAgent?.createPlan).toHaveBeenCalledWith({
      chipId: 'HK64S8x',
      requirement: 'Generate HK64S8x GPIO project.'
    });
  });

  it('does not force the chat history to the bottom when the user has scrolled up during updates', async () => {
    await renderAuthenticatedApp();

    const messageList = document.querySelector('.message-list') as HTMLElement;
    setMessageListScrollMetrics(messageList, {
      scrollHeight: 1000,
      clientHeight: 240,
      scrollTop: 120
    });
    fireEvent.scroll(messageList);

    const requirement = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(requirement, { target: { value: 'hello there' } });
    fireEvent.keyDown(requirement, { key: 'Enter', code: 'Enter' });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(messageList.scrollTop).toBe(120);
  });

  it('keeps following new chat output when the user is already near the bottom', async () => {
    await renderAuthenticatedApp();

    const messageList = document.querySelector('.message-list') as HTMLElement;
    setMessageListScrollMetrics(messageList, {
      scrollHeight: 1000,
      clientHeight: 240,
      scrollTop: 735
    });
    fireEvent.scroll(messageList);

    const requirement = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(requirement, { target: { value: 'hello there' } });
    fireEvent.keyDown(requirement, { key: 'Enter', code: 'Enter' });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(messageList.scrollTop).toBe(1000);
  });

  it('renders a validated single main.asm answer in chat while keeping the output preview panel', async () => {
    vi.useFakeTimers();
    await renderAuthenticatedApp();

    expect(document.querySelector('.project-panel')).not.toBeInTheDocument();
    expect(document.querySelector('.output-panel')).toBeInTheDocument();

    const requirement = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(requirement, { target: { value: 'Generate HK64S8x GPIO ASM project.' } });
    fireEvent.keyDown(requirement, { key: 'Enter', code: 'Enter' });

    await advanceLocalGeneration();

    expect(screen.getAllByText(/main\.asm/).length).toBeGreaterThan(0);
    expect(screen.getByText(/MOV PA_OE,A/).tagName).toBe('CODE');
    expect(screen.getByText(/MOV PA_PIO,A/).tagName).toBe('CODE');
    expect(screen.queryByText(/\bP0DIR\b|\bP0\b/)).not.toBeInTheDocument();
    expect(document.querySelector('.project-panel')).not.toBeInTheDocument();
    expect(document.querySelector('.output-panel')?.textContent).toContain('main.asm');
    expect(window.asmAgent?.generateProject).not.toHaveBeenCalled();
  });

  it('does not show the plan summary after generating the validated ASM output', async () => {
    vi.useFakeTimers();
    await renderAuthenticatedApp();

    const requirement = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(requirement, { target: { value: 'Generate HK64S8x GPIO ASM project.' } });
    fireEvent.keyDown(requirement, { key: 'Enter', code: 'Enter' });

    await advanceLocalGeneration();

    expect(screen.getAllByText(/main\.asm/).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('计划摘要')).not.toBeInTheDocument();
    expect(document.querySelector('.plan-summary')).not.toBeInTheDocument();
  });

  it('saves validated main.asm into the current session folder before showing it in the output panel', async () => {
    vi.useFakeTimers();
    await renderAuthenticatedApp();

    const requirement = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(requirement, { target: { value: 'Generate HK64S8x GPIO ASM project.' } });
    fireEvent.keyDown(requirement, { key: 'Enter', code: 'Enter' });

    await advanceLocalGeneration();

    expect(window.asmAgent?.saveAsmFile).toHaveBeenCalledWith({
      sessionId: expect.stringMatching(/^session-/),
      file: expect.objectContaining({
        path: 'main.asm',
        content: expect.stringContaining('MOV PA_OE,A')
      })
    });
    expect(document.querySelector('.output-panel')?.textContent).toContain('main.asm');
    expect(document.querySelector('.output-panel')?.textContent).toContain('C:\\ASM Agent Sessions\\');
  });

  it('uses the restored SVG assets for composer tool icons', async () => {
    await renderAuthenticatedApp();

    const toolIcons = Array.from(document.querySelectorAll<HTMLImageElement>('.composer-tool .composer-tool-icon'));

    expect(toolIcons.map((icon) => icon.getAttribute('src'))).toEqual([
      'icons/upload_file_restored.svg',
      'icons/add_reference_restored.svg',
      'icons/instruction_set_restored.svg'
    ]);
    expect(toolIcons.every((icon) => icon.getAttribute('alt') === '')).toBe(true);
    expect(toolIcons.every((icon) => icon.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('removes the composer smart suggestion button while keeping send available', async () => {
    await renderAuthenticatedApp();

    const composerActions = document.querySelector('.composer-actions') as HTMLElement;

    expect(screen.queryByRole('button', { name: '智能建议' })).not.toBeInTheDocument();
    expect(composerActions.querySelector('.composer-sparkle')).not.toBeInTheDocument();
    expect(within(composerActions).getByRole('button', { name: '发送需求' })).toBeInTheDocument();
  });

  it('uses the requested icon mapping for quick-start cards', async () => {
    await renderAuthenticatedApp();

    const quickStartIcons = Array.from(document.querySelectorAll<HTMLImageElement>('.prompt-card img'));

    expect(quickStartIcons.map((icon) => icon.getAttribute('src'))).toEqual([
      'icons/07_external_interrupt_icon.jpg',
      'icons/08_watchdog_flow_icon.jpg',
      'icons/06_gpio_output_icon.jpg',
      'icons/05_timer_icon.jpg'
    ]);
  });

  it('loads spec-driven safe prompts from every quick-start card', async () => {
    await renderAuthenticatedApp();

    const requirement = screen.getByLabelText('ASM 功能需求') as HTMLTextAreaElement;
    const examples = [
      { title: 'Timer0 精确定时中断', keyword: 'Timer0' },
      { title: 'GPIO 输出控制', keyword: 'PA0' },
      { title: '外部中断响应', keyword: 'PA1' },
      { title: '看门狗清狗流程', keyword: 'WDT' }
    ];

    for (const example of examples) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(example.title) }));

      expect(requirement.value).toContain('HK64S8x');
      expect(requirement.value).toContain(example.keyword);
      expect(requirement.value).toContain('parseAsm + validateAsm');
      expect(requirement.value).toContain('asm 代码块');
      expect(requirement.value).toContain('直接返回');
      expect(requirement.value).toContain('不要编造');
      expect(requirement.value).toContain('未确认寄存器');
    }
  });

  it('hides the welcome spec-ready module', async () => {
    await renderAuthenticatedApp();

    expect(document.querySelector('.spec-ready-card')).not.toBeInTheDocument();
    expect(screen.queryByText('HK64S8x ASM 规范库 已就绪')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '查看规范库' })).not.toBeInTheDocument();
  });

  it('uses an agent-style composer with model selection and enter-to-send', async () => {
    vi.useFakeTimers();
    await renderAuthenticatedApp();

    expect(document.querySelector('.output-panel')).toBeInTheDocument();
    const brandLogo = document.querySelector('.brand-mark img') as HTMLImageElement;
    expect(brandLogo).not.toBeNull();
    expect(brandLogo.getAttribute('src')).toBe('hsxp-logo.jpg');
    expect(screen.getByText('航顺 ASM Agent')).toBeInTheDocument();
    expect(screen.getByText('HK64S8x 工程助手')).toBeInTheDocument();
    expect(screen.getByText('规范库已锁定')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '新建对话' })).toBeInTheDocument();
    expect(screen.queryByText('目标平台')).not.toBeInTheDocument();
    expect(screen.getByLabelText('历史对话')).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: '调整侧边栏宽度' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '生成计划' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '生成工程' })).not.toBeInTheDocument();
    const modelSelector = screen.getByRole('button', { name: '选择模型' });
    expect(modelSelector).toBeInTheDocument();
    expect(document.querySelector('.model-picker select')).not.toBeInTheDocument();
    fireEvent.click(modelSelector);
    const modelMenu = screen.getByRole('listbox', { name: '选择模型' });
    expect(modelMenu).toHaveClass('model-picker-menu');
    expect(within(modelMenu).getByRole('option', { name: '本地规则引擎' })).toBeInTheDocument();
    expect(within(modelMenu).getByRole('option', { name: 'DeepSeek' })).toBeInTheDocument();
    expect(within(modelMenu).getByRole('option', { name: 'GLM' })).toBeInTheDocument();
    expect(within(modelMenu).getByRole('option', { name: 'GPT' })).toBeInTheDocument();
    expect(within(modelMenu).queryByRole('option', { name: 'HK64S8x Fast Agent' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '模型配置' })).not.toBeInTheDocument();
    expect(document.querySelector('.topbar-model')).not.toBeInTheDocument();
    expect(document.querySelector('.composer-hints')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送需求' })).toBeDisabled();

    const requirement = screen.getByLabelText('ASM 功能需求');
    fireEvent.change(requirement, { target: { value: '使用 Timer0 周期中断翻转 PA0 输出' } });
    expect(screen.getByRole('button', { name: '发送需求' })).not.toBeDisabled();

    fireEvent.keyDown(requirement, { key: 'Enter', code: 'Enter', shiftKey: true });
    expect(window.asmAgent?.createPlan).not.toHaveBeenCalled();

    fireEvent.keyDown(requirement, { key: 'Enter', code: 'Enter' });
    await advanceTimers(3200);
    expectPlanningTraceStarted();

    await advanceLocalGeneration();
    expect(window.asmAgent?.createPlan).toHaveBeenCalledWith({
      chipId: 'HK64S8x',
      requirement: '使用 Timer0 周期中断翻转 PA0 输出'
    });
  });

  it('starts a fresh conversation without replacing the previous conversation record', async () => {
    vi.useFakeTimers();
    await renderAuthenticatedApp();

    const requirement = screen.getByLabelText('ASM 功能需求');
    fireEvent.change(requirement, { target: { value: '使用 Timer0 周期中断翻转 PA0 输出' } });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    await advanceLocalGeneration();

    const sidebarBeforeNewSession = screen.getByLabelText('历史对话');
    expect(within(sidebarBeforeNewSession).getByText(/使用 Timer0 周期中断翻转 PA0/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '新建对话' }));

    const sidebarAfterNewSession = screen.getByLabelText('历史对话');
    expect(within(sidebarAfterNewSession).getByText('当前 ASM 会话')).toBeInTheDocument();
    expect(within(sidebarAfterNewSession).getByText(/使用 Timer0 周期中断翻转 PA0/)).toBeInTheDocument();
    expect(screen.getByLabelText('ASM 功能需求')).toHaveValue('');
  });

  it('switches back to an archived conversation from the recent conversation list', async () => {
    vi.useFakeTimers();
    await renderAuthenticatedApp();

    const firstRequirement = 'Generate HK64S8x GPIO ASM project.';
    const requirement = document.querySelector('#asm-requirement') as HTMLTextAreaElement;
    fireEvent.change(requirement, { target: { value: firstRequirement } });
    fireEvent.keyDown(requirement, { key: 'Enter', code: 'Enter' });

    await advanceLocalGeneration();

    expect(screen.getByText(firstRequirement)).toBeInTheDocument();
    expect(document.querySelector('.output-panel')?.textContent).toContain('main.asm');

    fireEvent.click(document.querySelector('.sidebar-new-button') as HTMLButtonElement);

    expect(screen.queryByText(firstRequirement)).not.toBeInTheDocument();

    const archivedConversation = Array.from(document.querySelectorAll<HTMLElement>('.conversation-item')).find((item) =>
      item.textContent?.includes('Generate HK64S8x GPIO')
    );
    expect(archivedConversation).toBeDefined();

    fireEvent.click(archivedConversation as HTMLElement);

    expect(screen.getByText(firstRequirement)).toBeInTheDocument();
    expect(document.querySelector('.output-panel')?.textContent).toContain('main.asm');
  });

  it('persists authenticated user conversations across app reloads', async () => {
    vi.useFakeTimers();
    const firstRender = render(<App />);
    await findWorkspaceShell();

    const firstRequirement = '持久化会话 A';
    fireEvent.change(screen.getByLabelText('ASM 功能需求'), { target: { value: firstRequirement } });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));
    await advanceLocalGeneration();

    fireEvent.click(screen.getByRole('button', { name: '新建对话' }));

    const secondRequirement = '持久化会话 B';
    fireEvent.change(screen.getByLabelText('ASM 功能需求'), { target: { value: secondRequirement } });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));
    await advanceLocalGeneration();

    await act(async () => {
      await Promise.resolve();
    });
    expect(window.localStorage.getItem('asm-agent-conversation-workspace:admin')).toContain(firstRequirement);

    firstRender.unmount();
    render(<App />);
    await findWorkspaceShell();

    const restoredConversationList = screen.getByLabelText('历史对话');
    expect(within(restoredConversationList).getByText(firstRequirement)).toBeInTheDocument();
    expect(within(restoredConversationList).getByText(secondRequirement)).toBeInTheDocument();

    const firstConversation = Array.from(restoredConversationList.querySelectorAll<HTMLElement>('.conversation-item')).find((item) =>
      item.textContent?.includes(firstRequirement)
    );
    expect(firstConversation).toBeDefined();
    fireEvent.click(firstConversation as HTMLElement);

    expect(document.querySelector('.assistant-panel')?.textContent).toContain(firstRequirement);
    expect(document.querySelector('.output-panel')?.textContent).toContain('main.asm');
  });

  it('keeps the conversation list order unchanged when selecting another conversation', async () => {
    await renderAuthenticatedApp();

    const requirement = screen.getByLabelText('ASM 功能需求');
    fireEvent.change(requirement, { target: { value: '测试1' } });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    fireEvent.click(screen.getByRole('button', { name: '新建对话' }));
    fireEvent.change(screen.getByLabelText('ASM 功能需求'), { target: { value: '测试2' } });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    const readConversationButtons = () =>
      Array.from(screen.getByLabelText('历史对话').querySelectorAll<HTMLElement>('.conversation-item'));
    const readConversationTitles = () =>
      readConversationButtons().map((item) => item.querySelector('.conversation-title')?.textContent ?? '');

    expect(readConversationTitles()).toEqual(['测试2', '测试1']);

    const firstConversation = readConversationButtons().find((item) => item.textContent?.includes('测试1'));
    expect(firstConversation).toBeDefined();
    fireEvent.click(firstConversation as HTMLElement);

    const buttonsAfterSelect = readConversationButtons();
    expect(readConversationTitles()).toEqual(['测试2', '测试1']);
    expect(buttonsAfterSelect[1]).toHaveClass('active');
    expect(buttonsAfterSelect[1]).toHaveTextContent('当前会话');
  });

  it('does not duplicate or drop conversations when rapidly clicking history items', async () => {
    await renderAuthenticatedApp();

    const submitRequirement = (value: string) => {
      fireEvent.change(screen.getByLabelText('ASM 功能需求'), { target: { value } });
      fireEvent.click(screen.getByRole('button', { name: '发送需求' }));
    };
    const readConversationButtons = () =>
      Array.from(screen.getByLabelText('历史对话').querySelectorAll<HTMLElement>('.conversation-item'));
    const readConversationTitles = () =>
      readConversationButtons().map((item) => item.querySelector('.conversation-title')?.textContent ?? '');

    submitRequirement('会话1');
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }));
    submitRequirement('会话2');
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }));
    submitRequirement('会话3');

    expect(readConversationTitles()).toEqual(['会话3', '会话2', '会话1']);

    const conversationOne = readConversationButtons().find((item) => item.textContent?.includes('会话1'));
    const conversationTwo = readConversationButtons().find((item) => item.textContent?.includes('会话2'));
    expect(conversationOne).toBeDefined();
    expect(conversationTwo).toBeDefined();

    act(() => {
      conversationOne?.click();
      conversationTwo?.click();
      conversationOne?.click();
    });

    const titlesAfterRapidClicks = readConversationTitles();
    expect(titlesAfterRapidClicks).toHaveLength(3);
    expect(new Set(titlesAfterRapidClicks)).toEqual(new Set(['会话1', '会话2', '会话3']));
    expect(readConversationButtons().filter((item) => item.textContent?.includes('当前会话'))).toHaveLength(1);
  });

  it('keeps an in-progress conversation running after switching away and back', async () => {
    vi.useFakeTimers();
    await renderAuthenticatedApp();

    const firstRequirement = '基于 HK64S8x 配置 Timer0，FOSC 16MHz、8 分频，实现 1ms 周期溢出中断。';
    fireEvent.change(screen.getByLabelText('ASM 功能需求'), { target: { value: firstRequirement } });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    await advanceTimers(3200);
    expect(screen.getByRole('button', { name: '停止生成' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '新建对话' }));
    expect(screen.queryByRole('button', { name: '停止生成' })).not.toBeInTheDocument();

    const runningConversation = Array.from(screen.getByLabelText('历史对话').querySelectorAll<HTMLElement>('.conversation-item')).find(
      (item) => item.textContent?.includes('Timer0')
    );
    expect(runningConversation).toBeDefined();
    expect(within(runningConversation as HTMLElement).getByLabelText('任务执行中')).toBeInTheDocument();

    fireEvent.click(runningConversation as HTMLElement);

    expect(screen.getByRole('button', { name: '停止生成' })).toBeInTheDocument();
    expect(document.querySelector('.agent-trace')?.textContent ?? '').not.toContain('已停止');

    await advanceLocalGeneration();
    expect(screen.queryByRole('button', { name: '停止生成' })).not.toBeInTheDocument();
  });

  it('attaches a background completion to its original conversation instead of the current conversation', async () => {
    vi.useFakeTimers();
    await renderAuthenticatedApp();

    const firstRequirement = '基于 HK64S8x 使能看门狗 WDT，并在主循环中按规范周期执行清狗指令。';
    fireEvent.change(screen.getByLabelText('ASM 功能需求'), { target: { value: firstRequirement } });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    await advanceTimers(3200);
    fireEvent.click(screen.getByRole('button', { name: '新建对话' }));

    await advanceLocalGeneration();

    expect(document.querySelector('.assistant-panel')?.textContent ?? '').not.toContain('已按内置 HK64S8x 规范生成单文件 ASM');
    expect(document.querySelector('.output-panel')?.textContent ?? '').toContain('暂无生成文件');

    const completedConversation = Array.from(screen.getByLabelText('历史对话').querySelectorAll<HTMLElement>('.conversation-item')).find(
      (item) => item.textContent?.includes('看门狗 WDT')
    );
    expect(completedConversation).toBeDefined();

    fireEvent.click(completedConversation as HTMLElement);

    expect(screen.getByText(/已按内置 HK64S8x 规范生成单文件 ASM/)).toBeInTheDocument();
    expect(document.querySelector('.output-panel')?.textContent ?? '').toContain('main.asm');
  });

  it('does not render the view-all conversations action in the recent conversation list', async () => {
    await renderAuthenticatedApp();

    const conversationList = screen.getByLabelText('历史对话');

    expect(within(conversationList).queryByRole('button', { name: '查看全部对话' })).not.toBeInTheDocument();
    expect(conversationList.querySelector('.conversation-view-all')).not.toBeInTheDocument();
  });

  it('opens the knowledge base from the sidebar navigation', async () => {
    await renderAuthenticatedApp();

    fireEvent.click(screen.getByRole('button', { name: '知识库' }));

    expect(screen.getByRole('region', { name: 'HK64S8x ASM 知识库' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'HK64S8x ASM 知识库' })).toBeInTheDocument();
    expect(screen.getByText('指令速查')).toBeInTheDocument();
    expect(screen.getByText('寄存器地图')).toBeInTheDocument();
    expect(screen.getByText('Timer0 定时')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '知识库' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: '首页' })).not.toHaveAttribute('aria-current');
    expect(screen.queryByText('自然语言到')).not.toBeInTheDocument();
  });

  it('removes the enterprise badge and regroups the topbar actions', async () => {
    await renderAuthenticatedApp();

    const topbar = document.querySelector('.chat-topbar') as HTMLElement;
    const actions = topbar.querySelector('.chat-topbar-actions') as HTMLElement;
    const utilityActions = actions.querySelector('.topbar-utility-actions');

    expect(topbar.querySelector('.topbar-enterprise')).not.toBeInTheDocument();
    expect(screen.queryByText('企业版')).not.toBeInTheDocument();
    expect(actions.querySelector('.topbar-primary-actions')).not.toBeInTheDocument();
    expect(utilityActions).toBeInTheDocument();
    expect(actions.querySelector('.topbar-model')).not.toBeInTheDocument();
    expect(actions.querySelector('.topbar-workspace')).not.toBeInTheDocument();
    expect(utilityActions?.querySelector('.topbar-version')?.textContent?.trim()).toMatch(/^v/);
    expect(utilityActions?.children).toHaveLength(1);
    expect(actions.querySelector('.topbar-icon-button')).not.toBeInTheDocument();
    expect(actions.querySelector('.topbar-badge')).not.toBeInTheDocument();
  });

  it('lets the divider resize the sidebar and remembers the chosen width', async () => {
    const shell = await renderAuthenticatedApp();
    const divider = screen.getByRole('separator', { name: '调整侧边栏宽度' });

    expect(shell).toHaveStyle({ '--sidebar-width': '260px' });
    expect(divider).toHaveAttribute('aria-valuemin', '220');
    expect(divider).toHaveAttribute('aria-valuemax', '420');
    expect(divider).toHaveAttribute('aria-valuenow', '260');

    act(() => {
      divider.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 260 }));
      window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 340 }));
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });

    expect(shell).toHaveStyle({ '--sidebar-width': '340px' });
    expect(divider).toHaveAttribute('aria-valuenow', '340');
    expect(window.localStorage.getItem('asm-agent-sidebar-width')).toBe('340');
  });

  it('lets the output divider resize the preview panel and remembers the chosen width', async () => {
    const shell = await renderAuthenticatedApp();
    const divider = document.querySelector('.output-resizer') as HTMLElement;

    expect(divider).not.toBeNull();
    expect(shell).toHaveStyle({ '--output-panel-width': '320px' });
    expect(divider).toHaveAttribute('role', 'separator');
    expect(divider).toHaveAttribute('aria-orientation', 'vertical');
    expect(divider).toHaveAttribute('aria-valuemin', '260');
    expect(divider).toHaveAttribute('aria-valuemax', '520');
    expect(divider).toHaveAttribute('aria-valuenow', '320');

    act(() => {
      divider.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 1000 }));
      window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 960 }));
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });

    expect(shell).toHaveStyle({ '--output-panel-width': '360px' });
    expect(divider).toHaveAttribute('aria-valuenow', '360');
    expect(window.localStorage.getItem('asm-agent-output-panel-width')).toBe('360');
  });

  it('marks the app shell as resizing while the output divider is being dragged', async () => {
    const shell = await renderAuthenticatedApp();
    const divider = document.querySelector('.output-resizer') as HTMLElement;

    expect(shell).not.toHaveClass('resizing');
    expect(shell).not.toHaveClass('resizing-output');

    act(() => {
      divider.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 1000 }));
    });

    expect(shell).toHaveClass('resizing');
    expect(shell).toHaveClass('resizing-output');

    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 960 }));
    });

    expect(shell).toHaveStyle({ '--output-panel-width': '360px' });

    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });

    expect(shell).not.toHaveClass('resizing');
    expect(shell).not.toHaveClass('resizing-output');
  });

  it('keeps the center workspace usable when the output divider is dragged too far left', async () => {
    const shell = await renderAuthenticatedApp();
    const divider = document.querySelector('.output-resizer') as HTMLElement;

    Object.defineProperty(shell, 'clientWidth', {
      configurable: true,
      value: 960
    });

    act(() => {
      divider.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 700 }));
      window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 260 }));
      window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    });

    const outputPanelWidth = Number(shell.style.getPropertyValue('--output-panel-width').replace('px', ''));
    expect(outputPanelWidth).toBeGreaterThanOrEqual(260);
    expect(outputPanelWidth).toBeLessThanOrEqual(300);
    expect(divider).toHaveAttribute('aria-valuenow', String(outputPanelWidth));
    expect(window.localStorage.getItem('asm-agent-output-panel-width')).toBe(String(outputPanelWidth));
  });

  it('supports keyboard resizing and clamps the sidebar width', async () => {
    window.localStorage.setItem('asm-agent-sidebar-width', '418');

    const shell = await renderAuthenticatedApp();
    const divider = screen.getByRole('separator', { name: '调整侧边栏宽度' });

    expect(shell).toHaveStyle({ '--sidebar-width': '418px' });

    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(shell).toHaveStyle({ '--sidebar-width': '420px' });
    expect(window.localStorage.getItem('asm-agent-sidebar-width')).toBe('420');

    fireEvent.keyDown(divider, { key: 'Home' });
    expect(shell).toHaveStyle({ '--sidebar-width': '220px' });
    expect(divider).toHaveAttribute('aria-valuenow', '220');

    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(shell).toHaveStyle({ '--sidebar-width': '220px' });
  });

  it('supports keyboard resizing and clamps the output preview width', async () => {
    window.localStorage.setItem('asm-agent-output-panel-width', '516');

    const shell = await renderAuthenticatedApp();
    const divider = document.querySelector('.output-resizer') as HTMLElement;

    expect(shell).toHaveStyle({ '--output-panel-width': '516px' });

    fireEvent.keyDown(divider, { key: 'ArrowLeft' });
    expect(shell).toHaveStyle({ '--output-panel-width': '520px' });
    expect(window.localStorage.getItem('asm-agent-output-panel-width')).toBe('520');

    fireEvent.keyDown(divider, { key: 'End' });
    expect(shell).toHaveStyle({ '--output-panel-width': '260px' });
    expect(divider).toHaveAttribute('aria-valuenow', '260');

    fireEvent.keyDown(divider, { key: 'ArrowRight' });
    expect(shell).toHaveStyle({ '--output-panel-width': '260px' });
  });

  it('shows the current user profile below the sidebar settings action', async () => {
    await renderAuthenticatedApp();

    const footer = document.querySelector('.sidebar-footer') as HTMLElement;
    const settingsButton = within(footer).getByRole('button', { name: '设置' });
    const userInfo = within(footer).getByRole('region', { name: '当前用户信息' });

    expect(userInfo).toHaveTextContent('姓名');
    expect(userInfo).toHaveTextContent('Admin');
    expect(userInfo).toHaveTextContent('岗位');
    expect(userInfo).toHaveTextContent('ASM 工程师');
    expect(Boolean(settingsButton.compareDocumentPosition(userInfo) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('loads the current user profile from the auth API when the app starts', async () => {
    getAuthApi().getCurrentUser.mockResolvedValueOnce({
      account: 'tangziliang',
      name: '汤子良',
      role: 'ASM 工程师'
    });

    await renderAuthenticatedApp();

    const userInfo = screen.getByRole('region', { name: '当前用户信息' });
    await waitFor(() => expect(userInfo).toHaveTextContent('汤子良'));
    expect(userInfo).toHaveTextContent('ASM 工程师');
  });

  it('keeps account actions in settings instead of the authenticated sidebar user card', async () => {
    await renderAuthenticatedApp();

    const userInfo = screen.getByRole('region', { name: '当前用户信息' });

    expect(within(userInfo).queryByRole('button', { name: '登录' })).not.toBeInTheDocument();
    expect(within(userInfo).queryByRole('button', { name: '注册' })).not.toBeInTheDocument();
    expect(within(userInfo).queryByRole('button', { name: '退出登录' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '用户登录注册' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    const dialog = screen.getByRole('dialog', { name: '设置' });
    expect(within(dialog).getByRole('heading', { name: '账号' })).toBeInTheDocument();
    expect(within(dialog).getByText('Admin')).toBeInTheDocument();
    expect(within(dialog).getByText('ASM 工程师')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '退出登录' })).toBeInTheDocument();
  });

  it('does not persist authenticated user data in the legacy localStorage profile slot', async () => {
    await renderAuthenticatedApp();

    expect(screen.getByRole('region', { name: '当前用户信息' })).toHaveTextContent('Admin');
    expect(window.localStorage.getItem('asm-agent-user-profile')).toBeNull();
  });

  it('does not unlock the workspace from a legacy localStorage profile without an authenticated user', async () => {
    getAuthApi().getCurrentUser.mockResolvedValueOnce(null);
    window.localStorage.setItem(
      'asm-agent-user-profile',
      JSON.stringify({
        account: 'legacy',
        name: '旧用户',
        role: '未注册用户'
      })
    );

    render(<App />);

    expect(await screen.findByRole('heading', { name: '登录 ASM Agent' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: '用户登录' })).toBeInTheDocument();
    expect(screen.queryByLabelText('ASM Agent 导航')).not.toBeInTheDocument();
    expect(screen.queryByText('旧用户')).not.toBeInTheDocument();
  });

  it('opens sidebar settings with general settings and about sections', async () => {
    await renderAuthenticatedApp();

    expect(screen.queryByText('API 已连接')).not.toBeInTheDocument();
    const sidebar = screen.getByLabelText('ASM Agent 导航');
    expect(within(sidebar).queryByText('main.asm')).not.toBeInTheDocument();
    expect(within(sidebar).getByRole('button', { name: '设置' })).toBeInTheDocument();
    expect(within(sidebar).queryByText('张工程师')).not.toBeInTheDocument();
    expect(within(sidebar).queryByText('研发部 · 嵌入式开发')).not.toBeInTheDocument();
    expect(sidebar.querySelector('.sidebar-profile')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    const dialog = screen.getByRole('dialog', { name: '设置' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '通用设置' })).toHaveClass('active');
    expect(within(dialog).getByRole('button', { name: '模型配置' })).toBeInTheDocument();
    expect(within(dialog).getByText('自动规范化 ASM')).toBeInTheDocument();
    expect(within(dialog).getByText('启用流式输出')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(2);

    fireEvent.click(within(dialog).getByRole('button', { name: '关于' }));

    expect(within(dialog).getByRole('button', { name: '关于' })).toHaveClass('active');
    expect(within(dialog).getByText('航顺 ASM Agent')).toBeInTheDocument();
    expect(within(dialog).getByText('当前版本')).toBeInTheDocument();
    expect(within(dialog).getByText('v0.1.0')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: '进入官网' })).toHaveAttribute('href', 'https://www.hsxp-hk.com/');

    fireEvent.click(within(dialog).getByRole('button', { name: '关闭设置' }));
    expect(screen.queryByRole('dialog', { name: '设置' })).not.toBeInTheDocument();
  });

  it('opens sidebar settings as a fixed app-level modal instead of clipped sidebar content', async () => {
    installAppStyles();
    await renderAuthenticatedApp();

    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    const sidebar = screen.getByLabelText('ASM Agent 导航');
    const backdrop = document.querySelector('.settings-backdrop') as HTMLElement;
    const dialog = screen.getByRole('dialog', { name: '设置' });
    const backdropStyle = getComputedStyle(backdrop);
    const dialogStyle = getComputedStyle(dialog);

    expect(backdrop).toBeInTheDocument();
    expect(backdrop.parentElement).toBe(document.body);
    expect(dialog.closest('.workspace-sidebar')).toBeNull();
    expect(sidebar).not.toContainElement(dialog);
    expect(backdropStyle.position).toBe('fixed');
    expect(['0', '0px']).toContain(backdropStyle.inset);
    expect(backdropStyle.display).toBe('grid');
    expect(backdropStyle.placeItems).toBe('center');
    expect(Number(backdropStyle.zIndex)).toBeGreaterThan(10);
    expect(dialogStyle.display).toBe('grid');
    expect(dialogStyle.overflow).toBe('hidden');
    expect(dialogStyle.gridTemplateColumns).toContain('minmax(0, 1fr)');
  });

  it('uses one consistent settings panel layout across general, model, and about tabs', async () => {
    installAppStyles();
    await renderAuthenticatedApp();

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    const dialog = screen.getByRole('dialog', { name: '设置' });
    const dialogStyle = getComputedStyle(dialog);

    expect(dialogStyle.width).toContain('780px');
    expect(dialogStyle.height).toContain('560px');
    expect(dialog).toHaveClass('settings-dialog');

    for (const tabName of ['通用设置', '模型配置', '关于']) {
      fireEvent.click(within(dialog).getByRole('button', { name: tabName }));

      const page = dialog.querySelector('.settings-page') as HTMLElement;
      expect(page).toBeInTheDocument();
      expect(page.querySelector('.settings-page-header')).toBeInTheDocument();
      expect(page.querySelector('.settings-page-description')).toBeInTheDocument();
      expect(page.querySelector('.settings-page-body')).toBeInTheDocument();
    }
  });

  it('opens a context menu for conversation rename, pin, delete, path copy, and folder reveal actions', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });

    await renderAuthenticatedApp();

    const conversation = screen.getByText('当前 ASM 会话').closest('.conversation-item') as HTMLElement;
    expect(conversation).not.toBeNull();

    fireEvent.contextMenu(conversation);

    const menu = screen.getByRole('menu', { name: '会话操作' });
    expect(within(menu).getByRole('menuitem', { name: '重命名' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: '置顶' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: '删除' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: '打开文件所在路径' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: '复制文件路径' })).toBeInTheDocument();

    fireEvent.click(within(menu).getByRole('menuitem', { name: '重命名' }));
    const nameInput = screen.getByLabelText('会话名称');
    fireEvent.change(nameInput, { target: { value: 'PA0 跑马灯' } });
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }));

    expect(screen.getByText('PA0 跑马灯')).toBeInTheDocument();
    const conversationStore = JSON.parse(window.localStorage.getItem('asm-agent-conversation-actions') ?? '{}') as {
      sessions?: Record<string, { title?: string }>;
    };
    expect(Object.values(conversationStore.sessions ?? {})).toContainEqual(expect.objectContaining({ title: 'PA0 跑马灯' }));

    fireEvent.contextMenu(screen.getByText('PA0 跑马灯').closest('.conversation-item') as HTMLElement);
    fireEvent.click(screen.getByRole('menuitem', { name: '置顶' }));

    expect(screen.getByText('已置顶')).toBeInTheDocument();
    expect(screen.getByText('PA0 跑马灯').closest('.conversation-item')).toHaveClass('pinned');

    fireEvent.contextMenu(screen.getByText('PA0 跑马灯').closest('.conversation-item') as HTMLElement);
    fireEvent.click(screen.getByRole('menuitem', { name: '复制文件路径' }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('main.asm'));
    expect(await screen.findByText('已复制文件路径')).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByText('PA0 跑马灯').closest('.conversation-item') as HTMLElement);
    fireEvent.click(screen.getByRole('menuitem', { name: '打开文件所在路径' }));

    expect(screen.getByText('网页调试版暂不支持打开系统文件夹')).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByText('PA0 跑马灯').closest('.conversation-item') as HTMLElement);
    fireEvent.click(screen.getByRole('menuitem', { name: '删除' }));

    expect(screen.queryByText('PA0 跑马灯')).not.toBeInTheDocument();
    expect(screen.getByText('暂无历史会话')).toBeInTheDocument();
  });

  it('opens third-party model API configuration from sidebar settings', async () => {
    await renderAuthenticatedApp();

    expect(screen.queryByRole('button', { name: '模型配置' })).not.toBeInTheDocument();
    expect(document.querySelector('.topbar-model')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    const settingsDialog = screen.getByRole('dialog', { name: '设置' });
    fireEvent.click(within(settingsDialog).getByRole('button', { name: '模型配置' }));

    expect(screen.queryByRole('dialog', { name: '模型 API 配置' })).not.toBeInTheDocument();
    expect(within(settingsDialog).getByRole('heading', { name: '模型 API 配置' })).toBeInTheDocument();
    expect(screen.getByLabelText('服务商')).toBeInTheDocument();
    expect(screen.getByLabelText('API Key')).toBeInTheDocument();
    expect(screen.getByLabelText('Base URL')).toBeInTheDocument();
    expect(screen.getByLabelText('Model ID')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('服务商'), { target: { value: 'deepseek' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test-key' } });
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://api.deepseek.com/v1' } });
    fireEvent.change(screen.getByLabelText('Model ID'), { target: { value: 'deepseek-chat' } });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    expect(screen.queryByRole('dialog', { name: '设置' })).not.toBeInTheDocument();
    expect(screen.getByText('API 已配置')).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem('asm-agent-model-config') ?? '{}')).toMatchObject({
      provider: 'deepseek',
      apiKey: 'sk-test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-chat'
    });
  });

  it('opens model configuration from local mode with an editable provider selected', async () => {
    await renderAuthenticatedApp();

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.click(screen.getByRole('button', { name: '模型配置' }));

    const provider = document.querySelector('#model-provider') as HTMLSelectElement;
    expect(provider).toBeInTheDocument();
    expect(provider.value).toBe('deepseek');
    expect(Array.from(provider.options).map((option) => option.value)).not.toContain('local');

    fireEvent.change(document.querySelector('#model-api-key') as HTMLInputElement, { target: { value: 'sk-test-key' } });
    fireEvent.change(document.querySelector('#model-base-url') as HTMLInputElement, { target: { value: 'https://api.deepseek.com/v1' } });
    fireEvent.change(document.querySelector('#model-id') as HTMLInputElement, { target: { value: 'deepseek-chat' } });
    fireEvent.click(document.querySelector('.primary-dialog-action') as HTMLButtonElement);

    expect(JSON.parse(window.localStorage.getItem('asm-agent-model-config') ?? '{}')).toMatchObject({
      provider: 'deepseek',
      selectedProvider: 'deepseek',
      apiKey: 'sk-test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      modelId: 'deepseek-chat'
    });
  });

  it('keeps provider draft credentials when switching providers before saving', async () => {
    await renderAuthenticatedApp();

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.click(screen.getByRole('button', { name: '模型配置' }));

    const provider = document.querySelector('#model-provider') as HTMLSelectElement;
    const apiKey = document.querySelector('#model-api-key') as HTMLInputElement;
    const baseUrl = document.querySelector('#model-base-url') as HTMLInputElement;
    const modelId = document.querySelector('#model-id') as HTMLInputElement;

    fireEvent.change(provider, { target: { value: 'custom' } });
    fireEvent.change(apiKey, { target: { value: 'sk-custom-draft' } });
    fireEvent.change(baseUrl, { target: { value: 'https://memory.example.com/v1' } });
    fireEvent.change(modelId, { target: { value: 'memory-chat' } });

    fireEvent.change(provider, { target: { value: 'deepseek' } });
    fireEvent.change(provider, { target: { value: 'custom' } });

    expect(apiKey).toHaveValue('sk-custom-draft');
    expect(baseUrl).toHaveValue('https://memory.example.com/v1');
    expect(modelId).toHaveValue('memory-chat');

    fireEvent.change(provider, { target: { value: 'deepseek' } });
    fireEvent.click(document.querySelector('.primary-dialog-action') as HTMLButtonElement);

    expect(JSON.parse(window.localStorage.getItem('asm-agent-model-config') ?? '{}')).toMatchObject({
      selectedProvider: 'deepseek',
      configs: {
        custom: {
          apiKey: 'sk-custom-draft',
          baseUrl: 'https://memory.example.com/v1',
          modelId: 'memory-chat'
        }
      }
    });
  });

  it('restores saved custom API credentials when reopening model settings', async () => {
    await renderAuthenticatedApp();

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.click(screen.getByRole('button', { name: '模型配置' }));

    fireEvent.change(document.querySelector('#model-provider') as HTMLSelectElement, { target: { value: 'custom' } });
    fireEvent.change(document.querySelector('#model-api-key') as HTMLInputElement, { target: { value: 'sk-remembered-test-key' } });
    fireEvent.change(document.querySelector('#model-base-url') as HTMLInputElement, {
      target: { value: 'https://tokens.example.test/v1' }
    });
    fireEvent.change(document.querySelector('#model-id') as HTMLInputElement, { target: { value: 'remembered-model' } });
    fireEvent.click(document.querySelector('.primary-dialog-action') as HTMLButtonElement);

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.click(screen.getByRole('button', { name: '模型配置' }));

    expect(document.querySelector('#model-provider')).toHaveValue('custom');
    expect(document.querySelector('#model-api-key')).toHaveValue('sk-remembered-test-key');
    expect(document.querySelector('#model-base-url')).toHaveValue('https://tokens.example.test/v1');
    expect(document.querySelector('#model-id')).toHaveValue('remembered-model');
  });

  it('adds and persists multiple custom OpenAI-compatible model records', async () => {
    await renderAuthenticatedApp();

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.click(screen.getByRole('button', { name: '模型配置' }));

    fireEvent.change(screen.getByLabelText('服务商'), { target: { value: 'custom' } });
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: '公司中转 GPT' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-primary-key' } });
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://primary.example.com/v1' } });
    fireEvent.change(screen.getByLabelText('Model ID'), { target: { value: 'primary-chat' } });

    fireEvent.click(screen.getByRole('button', { name: '新增自定义模型' }));
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: '备用 Qwen' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-backup-key' } });
    fireEvent.change(screen.getByLabelText('Base URL'), { target: { value: 'https://backup.example.com/v1' } });
    fireEvent.change(screen.getByLabelText('Model ID'), { target: { value: 'backup-chat' } });

    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));

    const saved = JSON.parse(window.localStorage.getItem('asm-agent-model-config') ?? '{}');
    expect(saved.selectedProvider).toBe('custom');
    expect(saved.customModels).toHaveLength(2);
    expect(saved.customModels).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: '公司中转 GPT',
          apiKey: 'sk-primary-key',
          baseUrl: 'https://primary.example.com/v1',
          modelId: 'primary-chat'
        }),
        expect.objectContaining({
          name: '备用 Qwen',
          apiKey: 'sk-backup-key',
          baseUrl: 'https://backup.example.com/v1',
          modelId: 'backup-chat'
        })
      ])
    );

    fireEvent.change(screen.getByLabelText('ASM 功能需求'), {
      target: { value: '今天是什么天气' }
    });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    expect(await screen.findByText('来自第三方模型的动态回答', undefined, externalModelWait)).toBeInTheDocument();
    expect(window.asmAgent?.completeChat).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'custom',
        apiKey: 'sk-backup-key',
        baseUrl: 'https://backup.example.com/v1',
        modelId: 'backup-chat'
      }),
      expect.any(AbortSignal)
    );

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.click(screen.getByRole('button', { name: '模型配置' }));
    fireEvent.click(screen.getByRole('button', { name: '公司中转 GPT' }));

    expect(screen.getByLabelText('模型名称')).toHaveValue('公司中转 GPT');
    expect(screen.getByLabelText('API Key')).toHaveValue('sk-primary-key');
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://primary.example.com/v1');
    expect(screen.getByLabelText('Model ID')).toHaveValue('primary-chat');
  });

  it('keeps model configuration inside the fixed settings modal instead of inline composer content', async () => {
    installAppStyles();
    await renderAuthenticatedApp();

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.click(screen.getByRole('button', { name: '模型配置' }));

    const composer = document.querySelector('.requirement-form') as HTMLElement;
    const backdrop = document.querySelector('.settings-backdrop') as HTMLElement;
    const dialog = screen.getByRole('dialog', { name: '设置' });
    const form = document.querySelector('.settings-model-form') as HTMLElement;
    const backdropStyle = getComputedStyle(backdrop);
    const dialogStyle = getComputedStyle(dialog);

    expect(document.querySelector('.topbar-model')).not.toBeInTheDocument();
    expect(backdrop).toBeInTheDocument();
    expect(form).toBeInTheDocument();
    expect(composer).not.toContainElement(form);
    expect(dialog).toContainElement(form);
    expect(backdropStyle.position).toBe('fixed');
    expect(['0', '0px']).toContain(backdropStyle.inset);
    expect(backdropStyle.display).toBe('grid');
    expect(backdropStyle.placeItems).toBe('center');
    expect(Number(backdropStyle.zIndex)).toBeGreaterThan(10);
    expect(dialogStyle.display).toBe('grid');
    expect(dialogStyle.overflow).toBe('hidden');
    expect(dialogStyle.backgroundColor).toBe('rgb(255, 255, 255)');
  });

  it('does not mark a third-party model as configured until key, base url, and model id are all present', async () => {
    window.localStorage.setItem(
      'asm-agent-model-config',
      JSON.stringify({
        provider: 'custom',
        apiKey: 'sk-test-key',
        baseUrl: '',
        modelId: ''
      })
    );

    await renderAuthenticatedApp();

    expect(screen.getByText('API 未完整配置')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('ASM 功能需求'), {
      target: { value: '今天是什么天气' }
    });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    expect(await screen.findByText(/我可以先按普通对话回答/)).toBeInTheDocument();
    expect(window.asmAgent?.completeChat).not.toHaveBeenCalled();
  });

  it('keeps API configuration status scoped to the selected provider', async () => {
    window.localStorage.setItem(
      'asm-agent-model-config',
      JSON.stringify({
        provider: 'custom',
        apiKey: 'sk-custom-key',
        baseUrl: 'https://api.example.com/v1',
        modelId: 'custom-chat'
      })
    );

    await renderAuthenticatedApp();

    expect(screen.getByText('API 已配置')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '选择模型' }));
    fireEvent.click(screen.getByRole('option', { name: 'GLM' }));
    expect(screen.getByText('API 未完整配置')).toBeInTheDocument();
    expect(screen.queryByText('API 已配置')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '选择模型' }));
    fireEvent.click(screen.getByRole('option', { name: 'custom-chat' }));
    expect(screen.getByText('API 已配置')).toBeInTheDocument();
  });

  it('shows saved custom model records as concrete composer model options', async () => {
    window.localStorage.setItem(
      'asm-agent-model-config',
      JSON.stringify({
        selectedProvider: 'custom',
        selectedCustomModelId: 'custom-backup',
        customModels: [
          {
            id: 'custom-primary',
            name: '公司中转 GPT',
            apiKey: 'sk-primary-key',
            baseUrl: 'https://primary.example.com/v1',
            modelId: 'primary-chat'
          },
          {
            id: 'custom-backup',
            name: '备用 Qwen',
            apiKey: 'sk-backup-key',
            baseUrl: 'https://backup.example.com/v1',
            modelId: 'backup-chat'
          }
        ]
      })
    );

    await renderAuthenticatedApp();

    const modelSelector = screen.getByRole('button', { name: '选择模型' });
    expect(modelSelector).toHaveTextContent('备用 Qwen');

    fireEvent.click(modelSelector);
    const modelMenu = screen.getByRole('listbox', { name: '选择模型' });
    expect(within(modelMenu).getByRole('option', { name: '公司中转 GPT' })).toBeInTheDocument();
    expect(within(modelMenu).getByRole('option', { name: '备用 Qwen' })).toHaveAttribute('aria-selected', 'true');
    expect(within(modelMenu).queryByRole('option', { name: '自定义 OpenAI 兼容模型' })).not.toBeInTheDocument();

    fireEvent.click(within(modelMenu).getByRole('option', { name: '公司中转 GPT' }));
    expect(modelSelector).toHaveTextContent('公司中转 GPT');

    fireEvent.change(screen.getByLabelText('ASM 功能需求'), {
      target: { value: '今天是什么天气' }
    });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    expect(await screen.findByText('来自第三方模型的动态回答', undefined, externalModelWait)).toBeInTheDocument();
    expect(window.asmAgent?.completeChat).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'custom',
        apiKey: 'sk-primary-key',
        baseUrl: 'https://primary.example.com/v1',
        modelId: 'primary-chat'
      }),
      expect.any(AbortSignal)
    );
    expect(JSON.parse(window.localStorage.getItem('asm-agent-model-config') ?? '{}').selectedCustomModelId).toBe('custom-primary');
  });

  it('answers ordinary identity questions without starting ASM project planning', async () => {
    await renderAuthenticatedApp();

    fireEvent.change(screen.getByLabelText('ASM 功能需求'), {
      target: { value: '你是什么大模型' }
    });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    expect(await screen.findByText(/我是 HK64S8x ASM 工程智能体/)).toBeInTheDocument();
    expect(screen.getByText(/也可以回答普通使用问题/)).toBeInTheDocument();
    expect(screen.queryByText(/工作日志/)).not.toBeInTheDocument();
    expect(screen.queryByText(/请补充目标功能/)).not.toBeInTheDocument();
    expect(window.asmAgent?.createPlan).not.toHaveBeenCalled();
  });

  it('uses the configured third-party model for ordinary chat instead of the fixed local fallback', async () => {
    window.localStorage.setItem(
      'asm-agent-model-config',
      JSON.stringify({
        provider: 'custom',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.example.com/v1',
        modelId: 'custom-chat'
      })
    );

    await renderAuthenticatedApp();

    fireEvent.change(screen.getByLabelText('ASM 功能需求'), {
      target: { value: '今天是什么天气' }
    });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    expect(await screen.findByText('来自第三方模型的动态回答', undefined, externalModelWait)).toBeInTheDocument();
    expect(screen.queryByText(/我可以先按普通对话回答/)).not.toBeInTheDocument();
    expect(window.asmAgent?.createPlan).not.toHaveBeenCalled();
    expect(window.asmAgent?.completeChat).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'custom',
        label: '自定义 OpenAI 兼容模型',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.example.com/v1',
        modelId: 'custom-chat',
        prompt: '今天是什么天气'
      }),
      expect.any(AbortSignal)
    );
  });

  it('turns the send button into a stop button while a model response is running', async () => {
    vi.useFakeTimers();
    if (!window.asmAgent?.completeChat) throw new Error('Expected completeChat test stub');
    let resolveModelAnswer: (answer: string) => void = () => {};
    vi.mocked(window.asmAgent.completeChat).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveModelAnswer = resolve;
        })
    );
    window.localStorage.setItem(
      'asm-agent-model-config',
      JSON.stringify({
        provider: 'custom',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.example.com/v1',
        modelId: 'custom-chat'
      })
    );

    await renderAuthenticatedApp();

    fireEvent.change(screen.getByLabelText('ASM 功能需求'), {
      target: { value: '生成 HK64S8x GPIO ASM 工程' }
    });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    const stopButton = screen.getByRole('button', { name: '停止生成' });
    expect(stopButton).toHaveClass('send-button', 'stop-button');
    expect(screen.queryByRole('button', { name: '发送需求' })).not.toBeInTheDocument();

    await advanceTimers(3200);
    const runningAction = document.querySelector('.trace-action.running');
    expect(runningAction).toBeInTheDocument();
    expect(runningAction?.textContent).toContain('生成成品 ASM');

    fireEvent.click(stopButton);
    expect(screen.getByRole('button', { name: '发送需求' })).toBeDisabled();
    expect(document.querySelector('.trace-action.running')).not.toBeInTheDocument();
    expect(document.querySelector('.trace-action')?.textContent).toContain('已停止');

    await act(async () => {
      resolveModelAnswer('Late model answer');
    });

    expect(screen.queryByText('Late model answer')).not.toBeInTheDocument();
    expect(screen.getByText('已停止生成。')).toBeInTheDocument();
    expect(document.querySelector('.trace-action.running')).not.toBeInTheDocument();
  });

  it('sends recent conversation messages to the configured model for context memory', async () => {
    if (!window.asmAgent?.completeChat) throw new Error('Expected completeChat test stub');
    vi.mocked(window.asmAgent.completeChat)
      .mockResolvedValueOnce('First model answer')
      .mockResolvedValueOnce('Second model answer');
    window.localStorage.setItem(
      'asm-agent-model-config',
      JSON.stringify({
        provider: 'custom',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.example.com/v1',
        modelId: 'custom-chat'
      })
    );

    await renderAuthenticatedApp();

    const requirement = screen.getByRole('textbox');
    fireEvent.change(requirement, { target: { value: 'My name is Zhang San. Please remember it.' } });
    fireEvent.keyDown(requirement, { key: 'Enter', code: 'Enter' });
    expect(await screen.findByText('First model answer', undefined, externalModelWait)).toBeInTheDocument();

    fireEvent.change(requirement, { target: { value: 'What is my name?' } });
    fireEvent.keyDown(requirement, { key: 'Enter', code: 'Enter' });
    expect(await screen.findByText('Second model answer', undefined, externalModelWait)).toBeInTheDocument();

    expect(window.asmAgent.completeChat).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        prompt: 'What is my name?',
        messages: [
          { role: 'user', content: 'My name is Zhang San. Please remember it.' },
          { role: 'assistant', content: 'First model answer' },
          { role: 'user', content: 'What is my name?' }
        ]
      }),
      expect.any(AbortSignal)
    );
  });

  it('renders markdown from assistant model responses as structured content', async () => {
    if (!window.asmAgent?.completeChat) throw new Error('Expected completeChat test stub');
    vi.mocked(window.asmAgent.completeChat).mockResolvedValueOnce(
      [
        '## 需求理解',
        '这是一个 **Timer0 中断工程**。',
        '',
        '1. 检查 `FOSC` 参数',
        '2. 生成中断入口',
        '',
        '- 使用内置规范校验',
        '- 缺少参数时继续追问',
        '',
        '```asm',
        'main_loop:',
        '  CLRWDT',
        '```'
      ].join('\n')
    );
    window.localStorage.setItem(
      'asm-agent-model-config',
      JSON.stringify({
        provider: 'custom',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.example.com/v1',
        modelId: 'custom-chat'
      })
    );

    await renderAuthenticatedApp();

    fireEvent.change(screen.getByLabelText('ASM 功能需求'), {
      target: { value: '今天是什么天气' }
    });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    expect(await screen.findByRole('heading', { level: 2, name: '需求理解' }, externalModelWait)).toBeInTheDocument();
    expect(screen.getByText('Timer0 中断工程').tagName).toBe('STRONG');
    expect(screen.getByText('FOSC').tagName).toBe('CODE');
    expect(
      screen.getByText((_, element) => element?.tagName === 'LI' && element.textContent === '检查 FOSC 参数')
    ).toBeInTheDocument();
    expect(screen.getByText('使用内置规范校验')).toBeInTheDocument();
    expect(screen.getByText(/main_loop:/).tagName).toBe('CODE');
  });

  it('normalizes a visible assistant ASM code block even when no draft requirement is staged', async () => {
    if (!window.asmAgent?.completeChat) throw new Error('Expected completeChat test stub');
    vi.mocked(window.asmAgent.completeChat).mockResolvedValueOnce(
      ['我先给出一段可规范化的 ASM 片段。', '', '```asm', 'MOV P1_DIR,A', 'MOV LED_DATA,A', '```'].join('\n')
    );
    window.localStorage.setItem(
      'asm-agent-model-config',
      JSON.stringify({
        provider: 'custom',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.example.com/v1',
        modelId: 'custom-chat'
      })
    );

    await renderAuthenticatedApp();

    fireEvent.change(screen.getByLabelText('ASM 功能需求'), {
      target: { value: '今天是什么天气' }
    });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    expect(await screen.findByText(/MOV P1_DIR,A/, undefined, externalModelWait)).toBeInTheDocument();
    expect(window.asmAgent.createPlan).not.toHaveBeenCalled();

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: '规范化' }));

    await advanceTimers(18000);
    const codeBlocks = Array.from(document.querySelectorAll('.markdown-code-block-shell'));
    const finalCodeBlock = codeBlocks.at(-1) as HTMLElement;
    expect(finalCodeBlock?.textContent).toContain('MOV PA_OE,A');
    expect(finalCodeBlock?.textContent).toContain('MOV PA_PIO,A');
    expect(within(finalCodeBlock).getByText('已规范')).toHaveClass('markdown-code-normalized-badge');
    expect(within(finalCodeBlock).queryByRole('button', { name: '规范化' })).not.toBeInTheDocument();
    expect(document.querySelector('.output-panel')?.textContent).toContain('main.asm');
    expect(screen.queryByRole('button', { name: '停止生成' })).not.toBeInTheDocument();
    expect(window.asmAgent.createPlan).toHaveBeenCalledWith({
      chipId: 'HK64S8x',
      requirement: expect.stringContaining('MOV P1_DIR,A')
    });
  });

  it('shows the toolchain trace before emitting normalized ASM output', async () => {
    if (!window.asmAgent?.completeChat) throw new Error('Expected completeChat test stub');
    vi.mocked(window.asmAgent.completeChat).mockResolvedValueOnce(
      ['我先给出一段可规范化的 ASM 片段。', '', '```asm', 'MOV P1_DIR,A', 'MOV LED_DATA,A', '```'].join('\n')
    );
    window.localStorage.setItem(
      'asm-agent-model-config',
      JSON.stringify({
        provider: 'custom',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.example.com/v1',
        modelId: 'custom-chat'
      })
    );

    await renderAuthenticatedApp();

    fireEvent.change(screen.getByLabelText('ASM 功能需求'), {
      target: { value: '今天是什么天气？' }
    });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    expect(await screen.findByText(/MOV P1_DIR,A/, undefined, externalModelWait)).toBeInTheDocument();

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: '规范化' }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    await advanceTimers(500);
    expect(document.body.textContent).toContain('收到需求');
    expect(screen.queryByText(/MOV PA_OE,A/)).not.toBeInTheDocument();

    await advanceTimers(18000);

    expect(screen.getByText(/MOV PA_OE,A/)).toBeInTheDocument();
    expect(screen.getByText(/MOV PA_PIO,A/)).toBeInTheDocument();
    expect(document.querySelector('.typing-dots')).not.toBeInTheDocument();
    const commandGroup = document.querySelector<HTMLDetailsElement>('.trace-tool-group');
    const commandToggle = document.querySelector<HTMLElement>('.trace-tg-head');
    const commandBody = document.querySelector<HTMLElement>('.trace-tg-body');
    expect(commandGroup).not.toBeNull();
    expect(commandToggle).not.toBeNull();
    expect(commandBody).not.toBeNull();
    expect(commandGroup?.open).toBe(false);
    fireEvent.click(commandToggle as HTMLElement);
    expect(commandGroup?.open).toBe(true);
    fireEvent.click(commandToggle as HTMLElement);
    expect(commandGroup?.open).toBe(false);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByRole('button', { name: '停止生成' })).not.toBeInTheDocument();
  });

  it('shows model API failures instead of silently falling back to the fixed ordinary chat template', async () => {
    if (!window.asmAgent) throw new Error('Expected asmAgent test stub');
    const completeChat = window.asmAgent.completeChat;
    if (!completeChat) throw new Error('Expected completeChat test stub');
    vi.mocked(completeChat).mockRejectedValueOnce(new Error('401 Unauthorized'));
    window.localStorage.setItem(
      'asm-agent-model-config',
      JSON.stringify({
        provider: 'deepseek',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.deepseek.com/v1',
        modelId: 'deepseek-chat'
      })
    );

    await renderAuthenticatedApp();

    fireEvent.change(screen.getByLabelText('ASM 功能需求'), {
      target: { value: '今天是什么天气' }
    });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    expect(await screen.findByText(/模型调用失败：401 Unauthorized/, undefined, externalModelWait)).toBeInTheDocument();
    expect(screen.queryByText(/我可以先按普通对话回答/)).not.toBeInTheDocument();
    expect(window.asmAgent?.createPlan).not.toHaveBeenCalled();
  });

  it('validates and publishes spec-constrained model ASM without local rewrite', async () => {
    vi.useFakeTimers();
    if (!window.asmAgent?.completeChat) throw new Error('Expected completeChat test stub');
    vi.mocked(window.asmAgent.completeChat).mockResolvedValueOnce(
      ['## 成品 ASM', '', '```asm', 'model_entry:', '  CLRWDT', '  JMP model_entry', '```'].join('\n')
    );
    window.localStorage.setItem(
      'asm-agent-model-config',
      JSON.stringify({
        provider: 'gpt',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.openai.com/v1',
        modelId: 'gpt-4o'
      })
    );

    await renderAuthenticatedApp();

    fireEvent.change(screen.getByLabelText('ASM 功能需求'), {
      target: { value: '生成一个精确 1ms 的 Timer0 中断工程。' }
    });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    await advanceTimers(5000);
    expect(screen.queryByRole('heading', { level: 2, name: '成品 ASM' })).not.toBeInTheDocument();
    expect(screen.queryByText(/model_entry/)).not.toBeInTheDocument();
    expect(document.body.textContent).toContain('带完整 HK64S8x JSON 规范约束');
    expect(document.body.textContent).toContain('质检模型返回 ASM');

    expect(document.querySelector('.workflow-bar')).not.toBeInTheDocument();
    expect(document.querySelector('.output-panel')).toBeInTheDocument();
    await advanceTimers(26000);

    const codeBlocks = Array.from(document.querySelectorAll('pre.markdown-code-block'));
    const finalCode = codeBlocks.at(-1)?.textContent ?? '';
    expect(finalCode).toContain('model_entry:');
    expect(finalCode).toContain('JMP model_entry');
    expect(finalCode).not.toContain('MOV PA_OE,A');
    expect(document.querySelector('.output-panel .output-file')).toBeInTheDocument();
    expect(document.querySelector('.output-panel')?.textContent).toContain('main.asm');
    expect(document.body.textContent).toContain('extract-asm --model gpt-4o');
    expect(document.body.textContent).toContain('运行 HK64S8x 规范校验');
    expect(document.body.textContent).toContain('编辑了 main.asm');
    expect(screen.queryByRole('button', { name: '停止生成' })).not.toBeInTheDocument();
    expect(window.asmAgent?.completeChat).toHaveBeenCalledTimes(1);
    expect(window.asmAgent?.completeChat).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('SPEC_DRIVEN_ASM_CONTEXT')
      }),
      expect.any(AbortSignal)
    );
    expect(window.asmAgent?.completeChat).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('"asmSyntax":"JMP K"')
      }),
      expect.any(AbortSignal)
    );
    expect(window.asmAgent?.completeChat).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('"name":"SCK_PS"')
      }),
      expect.any(AbortSignal)
    );
    expect(window.asmAgent?.createPlan).not.toHaveBeenCalled();
    expect(window.asmAgent?.saveAsmFile).toHaveBeenCalledWith(
      expect.objectContaining({
        file: {
          path: 'main.asm',
          content: ['model_entry:', '  CLRWDT', '  JMP model_entry', ''].join('\n')
        }
      })
    );
  });

  it('rejects invalid spec-constrained model ASM instead of locally rewriting it', async () => {
    vi.useFakeTimers();
    if (!window.asmAgent?.completeChat) throw new Error('Expected completeChat test stub');
    vi.mocked(window.asmAgent.completeChat)
      .mockResolvedValueOnce(
        ['## 成品 ASM', '', '```asm', 'model_entry:', '  MOV P1_DIR,A', '  JMP model_entry', '```'].join('\n')
      )
      .mockResolvedValueOnce(
        ['## 成品 ASM', '', '```asm', 'model_entry:', '  MOV P1_DIR,A', '  JMP model_entry', '```'].join('\n')
      );
    window.localStorage.setItem(
      'asm-agent-model-config',
      JSON.stringify({
        provider: 'gpt',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.openai.com/v1',
        modelId: 'gpt-4o'
      })
    );

    await renderAuthenticatedApp();

    fireEvent.change(screen.getByLabelText('ASM 功能需求'), {
      target: { value: '生成一个 GPIO ASM 工程。' }
    });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    await advanceTimers(31000);

    expect(document.body.textContent).toContain('ASM 质量闸失败：第 2 行 UNKNOWN_REGISTER：未知寄存器 P1_DIR');
    expect(document.querySelector('.output-panel')?.textContent).toContain('暂无生成文件');
    expect(window.asmAgent?.completeChat).toHaveBeenCalledTimes(2);
    expect(window.asmAgent?.createPlan).not.toHaveBeenCalled();
    expect(window.asmAgent?.saveAsmFile).not.toHaveBeenCalled();
    expect(screen.queryByText(/MOV PA_OE,A/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '停止生成' })).not.toBeInTheDocument();
  });

  it('repairs invalid model ASM once with quality diagnostics before saving', async () => {
    vi.useFakeTimers();
    if (!window.asmAgent?.completeChat) throw new Error('Expected completeChat test stub');
    vi.mocked(window.asmAgent.completeChat)
      .mockResolvedValueOnce(
        [
          '## 成品 ASM',
          '',
          '```asm',
          'INIT:',
          '  MOV A,#00H',
          '  MOV 34H,A',
          '  MOV A,#07H',
          '  MOV 35H,A',
          '  CLR 38H',
          '  CLR 82H',
          'MAIN_LOOP:',
          '  CLR 38H',
          '  MOV A,82H',
          '  MOV 80H,A',
          '  MOV A,#01H',
          '  OR A,80H',
          '  MOV 38H,A',
          '  CALL DELAY',
          '  INCR 82H',
          '  MOV A,82H',
          '  SE #04H',
          '  JMP MAIN_LOOP',
          '  JMP INIT',
          'DELAY:',
          '  MOV A,#FFH',
          '  MOV 81H,A',
          'DELAY_INNER:',
          '  DECSZ 81H',
          '  JMP DELAY_INNER',
          '  RET',
          '```'
        ].join('\n')
      )
      .mockResolvedValueOnce(
        [
          '## 修复后 ASM',
          '',
          '```asm',
          'INIT:',
          '  MOV A,#00H',
          '  MOV 34H,A',
          '  MOV A,#07H',
          '  MOV 35H,A',
          'MAIN_LOOP:',
          '  MOV A,#01H',
          '  MOV 38H,A',
          '  CALL DELAY_200MS',
          '  MOV A,#02H',
          '  MOV 38H,A',
          '  CALL DELAY_200MS',
          '  MOV A,#04H',
          '  MOV 38H,A',
          '  CALL DELAY_200MS',
          '  MOV A,#00H',
          '  MOV 38H,A',
          '  CALL DELAY_200MS',
          '  JMP MAIN_LOOP',
          'DELAY_200MS:',
          '  MOV A,#08H',
          '  MOV 82H,A',
          'DELAY_L3:',
          '  MOV A,#FFH',
          '  MOV 80H,A',
          'DELAY_L2:',
          '  MOV A,#FFH',
          '  MOV 81H,A',
          'DELAY_L1:',
          '  DECSZR 81H',
          '  JMP DELAY_L1',
          '  DECSZR 80H',
          '  JMP DELAY_L2',
          '  DECSZR 82H',
          '  JMP DELAY_L3',
          '  RET',
          '```'
        ].join('\n')
      );
    window.localStorage.setItem(
      'asm-agent-model-config',
      JSON.stringify({
        provider: 'gpt',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.openai.com/v1',
        modelId: 'gpt-4o'
      })
    );

    await renderAuthenticatedApp();

    fireEvent.change(screen.getByLabelText('ASM 功能需求'), {
      target: { value: '让 PA0 PA1 PA2 彩灯间隔闪烁 20ms。' }
    });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    await advanceTimers(36000);

    expect(document.body.textContent).toContain('带诊断重新生成 ASM');
    expect(document.body.textContent).toContain('修复后 ASM 通过');
    expect(window.asmAgent.completeChat).toHaveBeenCalledTimes(2);
    expect(window.asmAgent.completeChat).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        prompt: expect.stringContaining('ASM 需求行为质检失败')
      }),
      expect.any(AbortSignal)
    );
    expect(window.asmAgent.completeChat).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        prompt: expect.stringContaining('明确灯态')
      }),
      expect.any(AbortSignal)
    );
    expect(window.asmAgent.completeChat).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        prompt: expect.stringContaining('PA0 常亮')
      }),
      expect.any(AbortSignal)
    );
    expect(window.asmAgent.completeChat).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        prompt: expect.stringContaining('DECSZ 不会把减 1 结果写回 RAM')
      }),
      expect.any(AbortSignal)
    );
    expect(window.asmAgent.completeChat).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        prompt: expect.stringContaining('不要使用 ORG、END、EQU、DB、DS')
      }),
      expect.any(AbortSignal)
    );
    expect(window.asmAgent.completeChat).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        prompt: expect.stringContaining('R 只是操作数占位符')
      }),
      expect.any(AbortSignal)
    );
    expect(window.asmAgent.completeChat).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        prompt: expect.stringContaining('例如 80H')
      }),
      expect.any(AbortSignal)
    );
    expect(window.asmAgent?.createPlan).not.toHaveBeenCalled();
    expect(window.asmAgent?.saveAsmFile).toHaveBeenCalledWith(
      expect.objectContaining({
        file: {
          path: 'main.asm',
          content: [
            'INIT:',
            '  MOV A,#00H',
            '  MOV 34H,A',
            '  MOV A,#07H',
            '  MOV 35H,A',
            'MAIN_LOOP:',
            '  MOV A,#01H',
            '  MOV 38H,A',
            '  CALL DELAY_200MS',
            '  MOV A,#02H',
            '  MOV 38H,A',
            '  CALL DELAY_200MS',
            '  MOV A,#04H',
            '  MOV 38H,A',
            '  CALL DELAY_200MS',
            '  MOV A,#00H',
            '  MOV 38H,A',
            '  CALL DELAY_200MS',
            '  JMP MAIN_LOOP',
            'DELAY_200MS:',
            '  MOV A,#08H',
            '  MOV 82H,A',
            'DELAY_L3:',
            '  MOV A,#FFH',
            '  MOV 80H,A',
            'DELAY_L2:',
            '  MOV A,#FFH',
            '  MOV 81H,A',
            'DELAY_L1:',
            '  DECSZR 81H',
            '  JMP DELAY_L1',
            '  DECSZR 80H',
            '  JMP DELAY_L2',
            '  DECSZR 82H',
            '  JMP DELAY_L3',
            '  RET',
            ''
          ].join('\n')
        }
      })
    );
    expect(document.body.textContent).not.toContain('ASM 质量闸失败');
  });

  it('answers ASM concept questions as help instead of generating a project', async () => {
    await renderAuthenticatedApp();

    fireEvent.change(screen.getByLabelText('ASM 功能需求'), {
      target: { value: 'Timer0 精确 1ms 需要哪些参数' }
    });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    expect(await screen.findByText(/精确 1ms Timer0/)).toBeInTheDocument();
    expect(screen.getByText(/时钟源/)).toBeInTheDocument();
    expect(screen.getByText(/分频\/预分频/)).toBeInTheDocument();
    expect(screen.queryByText(/正在运行本地规则规划器/)).not.toBeInTheDocument();
    expect(window.asmAgent?.createPlan).not.toHaveBeenCalled();
  });

  it('stages planning progress before asking for missing timing inputs in the conversation', async () => {
    vi.useFakeTimers();
    if (!window.asmAgent) throw new Error('Expected asmAgent test stub');
    vi.mocked(window.asmAgent.createPlan).mockResolvedValueOnce({
      status: 'needsInput',
      questions: ['Please provide clock source and Timer0 prescaler settings.']
    });

    await renderAuthenticatedApp();

    const requirement = screen.getByRole('textbox');
    fireEvent.change(requirement, { target: { value: 'Generate a precise 1ms Timer0 interrupt project.' } });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    await advanceTimers(3200);
    expectPlanningTraceStarted();
    expect(screen.queryByText(/Please provide clock source and Timer0 prescaler settings/)).not.toBeInTheDocument();

    await advanceTimers(800);
    expectPlanningTraceStarted();
    expect(screen.queryByText(/1\/3/)).not.toBeInTheDocument();
    expect(screen.queryByText(/分析 1\/3/)).not.toBeInTheDocument();

    await advanceTimers(500);
    expect(screen.getByText(/收到需求/)).toBeInTheDocument();
    expect(screen.getByText(/加载指令与寻址约束/)).toBeInTheDocument();
    expect(screen.queryByText(/分析 1\/3/)).not.toBeInTheDocument();

    await advanceTimers(3000);
    expect(document.body.textContent).toContain('内置规范已加载');
    expect(document.body.textContent).toContain('运行本地规则规划器');
    expect(screen.queryByText(/Please provide clock source and Timer0 prescaler settings/)).not.toBeInTheDocument();
    expect(screen.queryByText(/分析 2\/3/)).not.toBeInTheDocument();

    await advanceTimers(2500);
    expect(document.body.textContent).toContain('已生成候选方案');
    expect(document.body.textContent).toContain('候选方案出来了');
    expect(screen.queryByText(/Please provide clock source and Timer0 prescaler settings/)).not.toBeInTheDocument();
    expect(screen.queryByText(/分析 3\/3/)).not.toBeInTheDocument();

    await advanceTimers(5200);
    expect(document.body.textContent).toContain('运行 HK64S8x 规范校验');
    expect(document.body.textContent).toContain('基础约束通过');
    expect(document.body.textContent).toContain('需要补充');

    await advanceTimers(1000);
    expect(screen.getByText(/Please provide clock source and Timer0 prescaler settings/)).toBeInTheDocument();
    expect(document.querySelector('.error-text')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '生成工程' })).not.toBeInTheDocument();
  });

  it('shows local toolchain logs and emits local validated ASM from the normalize action', async () => {
    vi.useFakeTimers();
    if (!window.asmAgent?.completeChat) throw new Error('Expected completeChat test stub');
    vi.mocked(window.asmAgent.completeChat).mockResolvedValueOnce(
      ['GPT 可展示分析：建议使用 Timer0，并等待本地规范化。', '', '```asm', 'MOV P1_DIR,A', '```'].join('\n')
    );
    window.localStorage.setItem(
      'asm-agent-model-config',
      JSON.stringify({
        provider: 'gpt',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.openai.com/v1',
        modelId: 'gpt-4o'
      })
    );

    await renderAuthenticatedApp();

    fireEvent.change(screen.getByLabelText('ASM 功能需求'), {
      target: { value: '今天是什么天气？' }
    });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    await advanceTimers(5000);
    expect(screen.getByText(/GPT 可展示分析/)).toBeInTheDocument();
    expect(window.asmAgent?.completeChat).toHaveBeenCalledTimes(1);
    expect(window.asmAgent?.createPlan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '规范化' }));

    await advanceTimers(18000);
    expect(screen.getByText(/MOV PA_OE,A/)).toBeInTheDocument();
    expect(window.asmAgent?.createPlan).toHaveBeenCalled();
    expect(document.body.textContent).toContain('运行 HK64S8x 规范校验');
    expect(document.body.textContent).toContain('编辑了 main.asm');
    expect(screen.getAllByText(/main\.asm/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '停止生成' })).not.toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it('invalidates the generated plan when the requirement changes', async () => {
    vi.useFakeTimers();
    await renderAuthenticatedApp();

    const requirement = screen.getByLabelText('ASM 功能需求');
    fireEvent.change(requirement, { target: { value: '使用 Timer0 周期中断翻转 PA0 输出' } });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    await advanceLocalGeneration();
    expect(screen.getAllByText(/main\.asm/).length).toBeGreaterThan(0);
    fireEvent.change(requirement, { target: { value: '使用 GPIO 轮询翻转 PA1 输出' } });

    expect(screen.queryByLabelText('计划摘要')).not.toBeInTheDocument();
    expect(window.asmAgent?.generateProject).not.toHaveBeenCalled();
  });

  it('uses the built-in browser fallback when preload is unavailable', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('asmAgent', undefined);
    Object.defineProperty(window, 'asmAgent', {
      configurable: true,
      value: undefined
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/auth/current-user') {
          return new Response(
            JSON.stringify({
              account: 'browser-user',
              name: 'Browser User',
              role: 'ASM 工程师'
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json'
              }
            }
          );
        }

        return new Response(JSON.stringify({ error: 'Unexpected test request.' }), {
          status: 404,
          headers: {
            'Content-Type': 'application/json'
          }
        });
      })
    );

    await renderAuthenticatedApp();

    expect(screen.queryByText('桥接 API 不可用')).not.toBeInTheDocument();
    expect(document.body.textContent).toContain('v0.0.6');

    fireEvent.change(screen.getByLabelText('ASM 功能需求'), {
      target: { value: '生成一个精确 1ms 的 Timer0 中断工程。' }
    });
    fireEvent.click(screen.getByRole('button', { name: '发送需求' }));

    await advanceLocalGeneration();
    expect(document.body.textContent).toContain('需要补充');
    expect(document.body.textContent).toContain('时钟源');
  });

  it('streams configured model responses in browser fallback mode', async () => {
    vi.stubGlobal('asmAgent', undefined);
    Object.defineProperty(window, 'asmAgent', {
      configurable: true,
      value: undefined
    });
    window.localStorage.setItem(
      'asm-agent-model-config',
      JSON.stringify({
        provider: 'custom',
        selectedProvider: 'custom',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.example.com/v1',
        modelId: 'custom-chat',
        configs: {
          custom: {
            apiKey: 'sk-test-key',
            baseUrl: 'https://api.example.com/v1',
            modelId: 'custom-chat'
          }
        }
      })
    );
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/auth/current-user') {
        return new Response(
          JSON.stringify({
            account: 'browser-user',
            name: 'Browser User',
            role: 'ASM 工程师'
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
      }

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"reasoning_content":"先分析需求。"}}]}\n\n'));
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"streamed "}}]}\n\n'));
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"answer"}}]}\n\n'));
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        }
      });

      return new Response(stream, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream'
        }
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await renderAuthenticatedApp();

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'hello there' }
    });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', code: 'Enter' });

    expect(await screen.findByText('streamed answer', undefined, externalModelWait)).toBeInTheDocument();
    expect(await screen.findByText('模型思考', undefined, externalModelWait)).toBeInTheDocument();
    expect(screen.getByText('先分析需求。')).toBeInTheDocument();
    expect(screen.queryByText('先分析需求。streamed answer')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/complete-chat-stream',
      expect.objectContaining({
        method: 'POST'
      })
    );
  });

  it('falls back to local browser auth when preload and auth endpoints are unavailable', async () => {
    vi.stubGlobal('asmAgent', undefined);
    Object.defineProperty(window, 'asmAgent', {
      configurable: true,
      value: undefined
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );

    render(<App />);

    const loginPage = await screen.findByRole('main', { name: '用户登录' });
    fireEvent.click(within(loginPage).getByRole('button', { name: '注册' }));
    fireEvent.change(within(loginPage).getByLabelText('登录账号'), { target: { value: 'browser-user' } });
    fireEvent.change(within(loginPage).getByLabelText('姓名'), { target: { value: 'Browser User' } });
    fireEvent.change(within(loginPage).getByLabelText('岗位'), { target: { value: 'ASM 工程师' } });
    fireEvent.change(within(loginPage).getByLabelText('设置密码'), { target: { value: 'secret123' } });
    fireEvent.click(within(loginPage).getByRole('button', { name: '完成注册' }));

    await waitFor(() => expect(screen.queryByRole('main', { name: '用户登录' })).not.toBeInTheDocument());
    expect(screen.getByRole('region', { name: '当前用户信息' })).toHaveTextContent('Browser User');

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    const settings = screen.getByRole('dialog', { name: '设置' });
    fireEvent.click(within(settings).getByRole('button', { name: '退出登录' }));

    const reloginPage = await screen.findByRole('main', { name: '用户登录' });
    fireEvent.change(within(reloginPage).getByLabelText('登录账号'), { target: { value: 'browser-user' } });
    fireEvent.change(within(reloginPage).getByLabelText('登录密码'), { target: { value: 'secret123' } });
    fireEvent.click(within(reloginPage).getByRole('button', { name: '登录' }));

    await waitFor(() => expect(screen.queryByRole('main', { name: '用户登录' })).not.toBeInTheDocument());
    expect(screen.getByRole('region', { name: '当前用户信息' })).toHaveTextContent('Browser User');
  });

  it('keeps direct model validation readable by hiding the raw model response and finalizing once', async () => {
    vi.useFakeTimers();
    if (!window.asmAgent) throw new Error('Expected asmAgent test stub');
    if (!window.asmAgent.completeChat) throw new Error('Expected completeChat test stub');
    vi.mocked(window.asmAgent.completeChat).mockResolvedValueOnce(
      ['External streamed analysis', '', '```asm', 'direct_entry:', '  CLRWDT', '  JMP direct_entry', '```'].join('\n')
    );
    vi.mocked(window.asmAgent.createPlan).mockResolvedValueOnce({
      status: 'ready',
      plan: {
        summary: 'Planned GPIO ASM project',
        chipId: 'HK64S8x',
        features: ['GPIO'],
        files: ['src/main.asm'],
        usesInterrupt: false,
        requiredRegisters: ['PA_PIO'],
        assumptions: []
      }
    });
    window.localStorage.setItem(
      'asm-agent-model-config',
      JSON.stringify({
        provider: 'custom',
        selectedProvider: 'custom',
        apiKey: 'sk-test-key',
        baseUrl: 'https://api.example.com/v1',
        modelId: 'custom-chat',
        configs: {
          custom: {
            apiKey: 'sk-test-key',
            baseUrl: 'https://api.example.com/v1',
            modelId: 'custom-chat'
          }
        }
      })
    );

    await renderAuthenticatedApp();

    const requirement = screen.getByRole('textbox');
    fireEvent.change(requirement, { target: { value: 'Generate HK64S8x GPIO ASM project.' } });
    fireEvent.keyDown(requirement, { key: 'Enter', code: 'Enter' });

    await advanceTimers(5000);
    expect(screen.queryByText(/External streamed analysis/)).not.toBeInTheDocument();
    expect(screen.queryByText(/MOV P1_DIR,A/)).not.toBeInTheDocument();
    expect(document.querySelectorAll('.trace-bubble')).toHaveLength(1);
    expect(screen.queryByText('Planned GPIO ASM project')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('计划摘要')).not.toBeInTheDocument();

    await advanceTimers(26000);
    expect(screen.getByText(/direct_entry:/)).toBeInTheDocument();
    expect(screen.getByText(/JMP direct_entry/)).toBeInTheDocument();
    expect(screen.queryByText(/MOV PA_OE,A/)).not.toBeInTheDocument();
    expect(screen.queryByText(/External streamed analysis/)).not.toBeInTheDocument();
    expect(screen.queryByText('Planned GPIO ASM project')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('计划摘要')).not.toBeInTheDocument();
    expect(screen.getAllByText(/main\.asm/).length).toBeGreaterThan(0);
    expect(window.asmAgent.completeChat).toHaveBeenCalledTimes(1);
    expect(window.asmAgent.createPlan).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.trace-bubble')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '停止生成' })).not.toBeInTheDocument();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  });
});
