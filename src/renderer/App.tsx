import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

import { AssistantChat } from './components/AssistantChat';
import { AuthPage } from './components/AuthPage';
import { ProjectOutputPanel } from './components/ProjectOutputPanel';
import { WorkspaceSidebar, type ArchivedConversation, type PrimaryNavId } from './components/WorkspaceSidebar';
import { useAgentSession, type AgentSessionSnapshot, type AgentSessionState } from './state/useAgentSession';
import { readSavedModelConfigState, saveModelConfigState } from './state/modelConfig';
import { getCurrentUserProfile, loginUser, logoutUser, registerUser } from './state/UserAuthClient';
import type { AuthLoginPayload, AuthRegisterPayload, AuthUserProfile } from '../shared/auth/UserAuthTypes';

const SIDEBAR_WIDTH_KEY = 'asm-agent-sidebar-width';
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_DEFAULT_WIDTH = 260;
const OUTPUT_PANEL_WIDTH_KEY = 'asm-agent-output-panel-width';
const OUTPUT_PANEL_MIN_WIDTH = 260;
const OUTPUT_PANEL_MAX_WIDTH = 520;
const OUTPUT_PANEL_DEFAULT_WIDTH = 320;
const RESIZER_WIDTH = 8;
const CENTER_WORKSPACE_MIN_WIDTH = 384;

type ResizeMode = 'sidebar' | 'output';

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function clampOutputPanelWidth(width: number, maxWidth = OUTPUT_PANEL_MAX_WIDTH): number {
  return Math.min(maxWidth, Math.max(OUTPUT_PANEL_MIN_WIDTH, Math.round(width)));
}

function getOutputPanelMaxWidth(shellWidth: number, sidebarWidth: number): number {
  if (!Number.isFinite(shellWidth) || shellWidth <= 0) return OUTPUT_PANEL_MAX_WIDTH;
  const availableWidth = shellWidth - sidebarWidth - RESIZER_WIDTH * 2 - CENTER_WORKSPACE_MIN_WIDTH;
  return Math.min(OUTPUT_PANEL_MAX_WIDTH, Math.max(OUTPUT_PANEL_MIN_WIDTH, Math.round(availableWidth)));
}

function readSavedSidebarWidth(): number {
  if (typeof window === 'undefined') return SIDEBAR_DEFAULT_WIDTH;
  const savedValue = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
  if (savedValue === null) return SIDEBAR_DEFAULT_WIDTH;
  const savedWidth = Number(savedValue);
  return Number.isFinite(savedWidth) ? clampSidebarWidth(savedWidth) : SIDEBAR_DEFAULT_WIDTH;
}

function readSavedOutputPanelWidth(): number {
  if (typeof window === 'undefined') return OUTPUT_PANEL_DEFAULT_WIDTH;
  const savedValue = window.localStorage.getItem(OUTPUT_PANEL_WIDTH_KEY);
  if (savedValue === null) return OUTPUT_PANEL_DEFAULT_WIDTH;
  const savedWidth = Number(savedValue);
  return Number.isFinite(savedWidth) ? clampOutputPanelWidth(savedWidth) : OUTPUT_PANEL_DEFAULT_WIDTH;
}

type AuthStatus = 'checking' | 'authenticated' | 'guest';

export function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking');
  const [currentUser, setCurrentUser] = useState<AuthUserProfile | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    void getCurrentUserProfile()
      .then((profile) => {
        if (!isMounted) return;
        setCurrentUser(profile);
        setAuthStatus(profile ? 'authenticated' : 'guest');
      })
      .catch((caught) => {
        if (!isMounted) return;
        setAuthError(caught instanceof Error ? caught.message : '认证状态检查失败');
        setAuthStatus('guest');
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleLogin = async (payload: AuthLoginPayload) => {
    const profile = await loginUser(payload);
    setCurrentUser(profile);
    setAuthError(null);
    setAuthStatus('authenticated');
  };

  const handleRegister = async (payload: AuthRegisterPayload) => {
    const profile = await registerUser(payload);
    setCurrentUser(profile);
    setAuthError(null);
    setAuthStatus('authenticated');
  };

  const handleLogout = async () => {
    await logoutUser();
    setCurrentUser(null);
    setAuthStatus('guest');
  };

  if (authStatus === 'checking') {
    return (
      <main className="auth-page" aria-label="登录状态检查">
        <section className="auth-dialog auth-page-card">
          <div className="auth-loading">正在检查登录状态...</div>
        </section>
      </main>
    );
  }

  if (!currentUser) {
    return <AuthPage initialError={authError} onLogin={handleLogin} onRegister={handleRegister} />;
  }

  return <AgentWorkspace currentUser={currentUser} onLogout={handleLogout} />;
}

function createArchivedConversation(session: Pick<AgentSessionState, 'sessionId' | 'messages' | 'asmFile'>): ArchivedConversation | null {
  const userMessages = session.messages.filter((message) => message.role === 'user');
  const latestUserMessage = userMessages[userMessages.length - 1];
  if (!latestUserMessage) return null;

  return {
    id: session.sessionId,
    title: latestUserMessage.text,
    meta: 'history',
    filePath: session.asmFile?.absolutePath ?? session.asmFile?.path ?? 'main.asm'
  };
}

const KNOWLEDGE_TITLE = 'HK8S8100X ASM 知识库';

const KNOWLEDGE_CATEGORIES = [
  {
    title: '指令速查',
    count: '32 条',
    description: '常用数据传送、位操作、跳转与清狗指令。'
  },
  {
    title: '寄存器地图',
    count: '18 组',
    description: 'PA 口、Timer0、中断、WDT 相关寄存器分组。'
  },
  {
    title: 'Timer0 定时',
    count: '6 篇',
    description: '预分频、重装值、溢出周期和中断入口配置。'
  }
];

const KNOWLEDGE_ENTRIES = [
  {
    group: '指令',
    name: 'MOV',
    description: '寄存器与累加器之间的数据传送。'
  },
  {
    group: '指令',
    name: 'CLRWDT',
    description: '清看门狗计数器，主循环内按规范周期调用。'
  },
  {
    group: '寄存器',
    name: 'PA_OE',
    description: 'PA 口输出使能控制，配置推挽输出前需要设置。'
  },
  {
    group: '寄存器',
    name: 'PA_PIO',
    description: 'PA 口数字 IO 模式控制，避免默认复用功能干扰。'
  },
  {
    group: 'Timer0',
    name: 'T0_PS',
    description: 'Timer0 预分频配置，用于计算溢出周期。'
  },
  {
    group: '中断',
    name: 'INTF',
    description: '中断标志位清除入口，ISR 内需要及时处理。'
  }
];

const KNOWLEDGE_FLOW = ['选择外设模块', '确认寄存器', '套用初始化顺序', '生成 ASM 模板', '本地规范校验'];

function KnowledgeBasePanel() {
  return (
    <section className="panel knowledge-panel" aria-label={KNOWLEDGE_TITLE}>
      <header className="knowledge-header">
        <div>
          <span className="panel-kicker">Knowledge</span>
          <h1>{KNOWLEDGE_TITLE}</h1>
          <p>内置规范库的可视化入口，用来快速核对指令、寄存器、外设流程和生成约束。</p>
        </div>
        <label className="knowledge-search" htmlFor="knowledge-search">
          <span aria-hidden="true">⌕</span>
          <input id="knowledge-search" placeholder="搜索指令、寄存器或外设流程" />
        </label>
      </header>

      <div className="knowledge-content">
        <div className="knowledge-category-grid">
          {KNOWLEDGE_CATEGORIES.map((category) => (
            <section className="knowledge-category" key={category.title}>
              <div>
                <span>{category.count}</span>
                <h2>{category.title}</h2>
              </div>
              <p>{category.description}</p>
            </section>
          ))}
        </div>

        <section className="knowledge-section knowledge-index">
          <div className="knowledge-section-head">
            <h2>常用条目</h2>
            <span>HK8S8100X</span>
          </div>
          <dl>
            {KNOWLEDGE_ENTRIES.map((entry) => (
              <div key={`${entry.group}-${entry.name}`}>
                <dt>
                  <span>{entry.group}</span>
                  <code>{entry.name}</code>
                </dt>
                <dd>{entry.description}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="knowledge-section knowledge-flow">
          <div className="knowledge-section-head">
            <h2>生成前核对流程</h2>
            <span>推荐顺序</span>
          </div>
          <ol>
            {KNOWLEDGE_FLOW.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
      </div>
    </section>
  );
}

function AgentWorkspace({ currentUser, onLogout }: { currentUser: AuthUserProfile; onLogout: () => void }) {
  const session = useAgentSession();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [activeNav, setActiveNav] = useState<PrimaryNavId>('home');
  const [archivedSessions, setArchivedSessions] = useState<AgentSessionSnapshot[]>([]);
  const [conversationOrder, setConversationOrder] = useState<string[]>(() => [session.sessionId]);
  const [sidebarWidth, setSidebarWidth] = useState(readSavedSidebarWidth);
  const [outputPanelWidth, setOutputPanelWidth] = useState(readSavedOutputPanelWidth);
  const [resizeMode, setResizeMode] = useState<ResizeMode | null>(null);
  const [modelConfigState, setModelConfigState] = useState(readSavedModelConfigState);
  const archivedConversations = useMemo(
    () =>
      archivedSessions
        .map(createArchivedConversation)
        .filter((conversation): conversation is ArchivedConversation => conversation !== null),
    [archivedSessions]
  );

  useEffect(() => {
    setConversationOrder((current) => {
      if (current.includes(session.sessionId)) return current;
      return [...current, session.sessionId];
    });
  }, [session.sessionId]);

  useEffect(() => {
    const visibleSessionIds = new Set([session.sessionId, ...archivedConversations.map((conversation) => conversation.id)]);
    setConversationOrder((current) => current.filter((sessionId) => visibleSessionIds.has(sessionId)));
  }, [archivedConversations, session.sessionId]);

  const updateModelConfigState = (updater: Parameters<typeof setModelConfigState>[0]) => {
    setModelConfigState((current) => {
      const nextState = typeof updater === 'function' ? updater(current) : updater;
      saveModelConfigState(nextState);
      return nextState;
    });
  };

  const handleNewSession = () => {
    const snapshot = session.createSnapshot();
    const archivedConversation = createArchivedConversation(snapshot);

    if (archivedConversation) {
      setArchivedSessions((current) => [...current.filter((archivedSession) => archivedSession.sessionId !== snapshot.sessionId), snapshot]);
    }

    const newSessionId = session.resetSession();
    setConversationOrder((current) => [newSessionId, ...current.filter((sessionId) => sessionId !== newSessionId)]);
    setActiveNav('home');
  };

  const handleSelectConversation = (conversationId: string) => {
    if (conversationId === session.sessionId) {
      setActiveNav('home');
      return;
    }

    const selectedSession = archivedSessions.find((archivedSession) => archivedSession.sessionId === conversationId);
    if (!selectedSession) return;

    const currentSnapshot = session.createSnapshot();
    const currentConversation = createArchivedConversation(currentSnapshot);

    setArchivedSessions((current) => {
      return current.map((archivedSession) => {
        if (archivedSession.sessionId === selectedSession.sessionId) {
          return currentConversation ? currentSnapshot : archivedSession;
        }
        return archivedSession;
      });
    });
    session.restoreSnapshot(selectedSession);
    setActiveNav('home');
  };

  const updateSidebarWidth = (width: number) => {
    const nextWidth = clampSidebarWidth(width);
    setSidebarWidth(nextWidth);
    window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(nextWidth));
  };

  const updateOutputPanelWidth = (width: number) => {
    const nextWidth = clampOutputPanelWidth(width, getOutputPanelMaxWidth(shellRef.current?.clientWidth ?? 0, sidebarWidth));
    setOutputPanelWidth(nextWidth);
    window.localStorage.setItem(OUTPUT_PANEL_WIDTH_KEY, String(nextWidth));
  };

  useEffect(() => {
    const clampCurrentOutputWidth = () => {
      const nextWidth = clampOutputPanelWidth(outputPanelWidth, getOutputPanelMaxWidth(shellRef.current?.clientWidth ?? 0, sidebarWidth));
      if (nextWidth === outputPanelWidth) return;
      setOutputPanelWidth(nextWidth);
      window.localStorage.setItem(OUTPUT_PANEL_WIDTH_KEY, String(nextWidth));
    };

    clampCurrentOutputWidth();
    window.addEventListener('resize', clampCurrentOutputWidth);
    return () => window.removeEventListener('resize', clampCurrentOutputWidth);
  }, [outputPanelWidth, sidebarWidth]);

  const handleSidebarResizeStart = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setResizeMode('sidebar');
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const resizeTarget = event.currentTarget;
    const pointerId = event.pointerId;

    const handlePointerMove = (moveEvent: globalThis.PointerEvent | MouseEvent) => {
      updateSidebarWidth(startWidth + moveEvent.clientX - startX);
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      resizeTarget.releasePointerCapture?.(pointerId);
      setResizeMode(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleOutputResizeStart = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setResizeMode('output');
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startX = event.clientX;
    const startWidth = outputPanelWidth;
    const resizeTarget = event.currentTarget;
    const pointerId = event.pointerId;

    const handlePointerMove = (moveEvent: globalThis.PointerEvent | MouseEvent) => {
      updateOutputPanelWidth(startWidth - (moveEvent.clientX - startX));
    };

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      resizeTarget.releasePointerCapture?.(pointerId);
      setResizeMode(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handleSidebarResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      updateSidebarWidth(sidebarWidth - 12);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      updateSidebarWidth(sidebarWidth + 12);
    } else if (event.key === 'Home') {
      event.preventDefault();
      updateSidebarWidth(SIDEBAR_MIN_WIDTH);
    } else if (event.key === 'End') {
      event.preventDefault();
      updateSidebarWidth(SIDEBAR_MAX_WIDTH);
    }
  };

  const handleOutputResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      updateOutputPanelWidth(outputPanelWidth + 12);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      updateOutputPanelWidth(outputPanelWidth - 12);
    } else if (event.key === 'Home') {
      event.preventDefault();
      updateOutputPanelWidth(OUTPUT_PANEL_MAX_WIDTH);
    } else if (event.key === 'End') {
      event.preventDefault();
      updateOutputPanelWidth(OUTPUT_PANEL_MIN_WIDTH);
    }
  };

  const shellStyle = {
    '--sidebar-width': `${sidebarWidth}px`,
    '--output-panel-width': `${outputPanelWidth}px`
  } as CSSProperties;
  const shellClassName = resizeMode ? `app-shell resizing resizing-${resizeMode}` : 'app-shell';

  return (
    <div className={shellClassName} style={shellStyle} ref={shellRef}>
      <WorkspaceSidebar
        chipId={session.chipId}
        sessionId={session.sessionId}
        messages={session.messages}
        currentFilePath={session.asmFile?.absolutePath ?? session.asmFile?.path ?? 'main.asm'}
        archivedConversations={archivedConversations}
        conversationOrder={conversationOrder}
        modelConfigState={modelConfigState}
        onModelConfigStateChange={updateModelConfigState}
        activeNav={activeNav}
        onNavigate={setActiveNav}
        onNewSession={handleNewSession}
        onSelectConversation={handleSelectConversation}
        currentUser={currentUser}
        onLogout={onLogout}
      />
      <div
        className="sidebar-resizer"
        role="separator"
        aria-label="调整侧边栏宽度"
        aria-orientation="vertical"
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        onPointerDown={handleSidebarResizeStart}
        onKeyDown={handleSidebarResizeKeyDown}
      />
      {activeNav === 'knowledge' ? (
        <KnowledgeBasePanel />
      ) : (
        <AssistantChat session={session} modelConfigState={modelConfigState} onModelConfigStateChange={updateModelConfigState} />
      )}
      <div
        className="output-resizer"
        role="separator"
        aria-label="调整工程输出预览宽度"
        aria-orientation="vertical"
        aria-valuemin={OUTPUT_PANEL_MIN_WIDTH}
        aria-valuemax={OUTPUT_PANEL_MAX_WIDTH}
        aria-valuenow={outputPanelWidth}
        tabIndex={0}
        onPointerDown={handleOutputResizeStart}
        onKeyDown={handleOutputResizeKeyDown}
      />
      <ProjectOutputPanel session={session} />
    </div>
  );
}
