import { useState, type FormEvent } from 'react';

import type { AuthLoginPayload, AuthRegisterPayload } from '../../shared/auth/UserAuthTypes';

type AuthMode = 'login' | 'register';

interface AuthDraftState {
  account: string;
  name: string;
  role: string;
  password: string;
}

interface AuthPageProps {
  initialError?: string | null;
  onLogin: (payload: AuthLoginPayload) => Promise<void>;
  onRegister: (payload: AuthRegisterPayload) => Promise<void>;
}

const EMPTY_DRAFT: AuthDraftState = {
  account: '',
  name: '',
  role: 'ASM 工程师',
  password: ''
};

function readErrorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : '认证请求失败';
}

export function AuthPage({ initialError = null, onLogin, onRegister }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [draft, setDraft] = useState<AuthDraftState>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(initialError);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError(null);
    setDraft((current) => ({
      ...EMPTY_DRAFT,
      account: current.account,
      password: ''
    }));
  };

  const updateDraft = (field: keyof AuthDraftState, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (mode === 'login') {
        await onLogin({
          account: draft.account.trim(),
          password: draft.password.trim()
        });
      } else {
        await onRegister({
          account: draft.account.trim(),
          name: draft.name.trim(),
          role: draft.role.trim(),
          password: draft.password.trim()
        });
      }
    } catch (caught) {
      setError(readErrorMessage(caught));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="auth-page" aria-label="用户登录">
      <section className="auth-dialog auth-page-card">
        <header className="auth-dialog-header auth-page-header">
          <div className="auth-brand-lockup">
            <span className="auth-logo" aria-hidden="true">
              <img src="hsxp-logo.jpg" alt="" />
            </span>
            <div>
              <span className="settings-page-kicker">ASM Agent</span>
              <h1>登录 ASM Agent</h1>
              <p>请先使用已注册账号登录；未注册用户不能访问工程生成、知识库和历史会话内容。</p>
            </div>
          </div>
        </header>

        <div className="auth-tabs" aria-label="用户登录注册">
          <button
            className={mode === 'login' ? 'active' : ''}
            type="button"
            aria-label="切换到登录"
            onClick={() => switchMode('login')}
          >
            登录
          </button>
          <button className={mode === 'register' ? 'active' : ''} type="button" onClick={() => switchMode('register')}>
            注册
          </button>
        </div>

        <form className="auth-form" onSubmit={submitAuth}>
          <label htmlFor="auth-account">登录账号</label>
          <input
            id="auth-account"
            value={draft.account}
            onChange={(event) => updateDraft('account', event.target.value)}
            placeholder="例如：zhangsan"
            autoComplete="username"
            required
          />

          {mode === 'register' ? (
            <>
              <label htmlFor="auth-name">姓名</label>
              <input
                id="auth-name"
                value={draft.name}
                onChange={(event) => updateDraft('name', event.target.value)}
                placeholder="请输入姓名"
                required
              />

              <label htmlFor="auth-role">岗位</label>
              <input
                id="auth-role"
                value={draft.role}
                onChange={(event) => updateDraft('role', event.target.value)}
                placeholder="请输入岗位"
                required
              />
            </>
          ) : null}

          <label htmlFor="auth-password">{mode === 'register' ? '设置密码' : '登录密码'}</label>
          <input
            id="auth-password"
            type="password"
            value={draft.password}
            onChange={(event) => updateDraft('password', event.target.value)}
            placeholder={mode === 'register' ? '设置本地登录密码' : '输入本地登录密码'}
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            minLength={6}
            required
          />

          {error ? (
            <div className="auth-form-error" role="alert">
              {error}
            </div>
          ) : null}

          <div className="auth-dialog-actions">
            <button className="primary-dialog-action auth-submit-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? '处理中...' : mode === 'login' ? '登录' : '完成注册'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
