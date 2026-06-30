import type { AuthOkResult, AuthRegisterPayload, AuthUserProfile } from '../../shared/auth/UserAuthTypes';

interface BrowserAuthUserRecord extends AuthUserProfile {
  password: string;
}

interface BrowserAuthSnapshot {
  users: BrowserAuthUserRecord[];
  currentAccount: string | null;
}

const BROWSER_AUTH_STORAGE_KEY = 'asm-agent-browser-auth';

function readSnapshot(): BrowserAuthSnapshot {
  if (typeof window === 'undefined') {
    return { users: [], currentAccount: null };
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(BROWSER_AUTH_STORAGE_KEY) ?? '{}') as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { users: [], currentAccount: null };
    }

    const record = parsed as Record<string, unknown>;
    const users = Array.isArray(record.users)
      ? record.users
          .map((entry) => {
            if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null;
            const user = entry as Record<string, unknown>;
            if (
              typeof user.account !== 'string' ||
              typeof user.name !== 'string' ||
              typeof user.role !== 'string' ||
              typeof user.password !== 'string'
            ) {
              return null;
            }

            return {
              account: user.account,
              name: user.name,
              role: user.role,
              password: user.password
            };
          })
          .filter((entry): entry is BrowserAuthUserRecord => entry !== null)
      : [];

    return {
      users,
      currentAccount: typeof record.currentAccount === 'string' ? record.currentAccount : null
    };
  } catch {
    return { users: [], currentAccount: null };
  }
}

function writeSnapshot(snapshot: BrowserAuthSnapshot): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(BROWSER_AUTH_STORAGE_KEY, JSON.stringify(snapshot));
}

function normalizeRequiredText(value: string, errorMessage: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(errorMessage);
  return normalized;
}

function normalizePassword(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error('密码不能为空');
  if (normalized.length < 6) throw new Error('密码至少需要 6 位');
  return normalized;
}

function toPublicUser(user: BrowserAuthUserRecord): AuthUserProfile {
  return {
    account: user.account,
    name: user.name,
    role: user.role
  };
}

export function getBrowserCurrentUser(): AuthUserProfile | null {
  const snapshot = readSnapshot();
  if (!snapshot.currentAccount) return null;

  const currentUser = snapshot.users.find((user) => user.account === snapshot.currentAccount);
  return currentUser ? toPublicUser(currentUser) : null;
}

export function registerBrowserUser(payload: AuthRegisterPayload): AuthUserProfile {
  const account = normalizeRequiredText(payload.account, '登录账号不能为空');
  const name = normalizeRequiredText(payload.name, '姓名不能为空');
  const role = normalizeRequiredText(payload.role, '岗位不能为空');
  const password = normalizePassword(payload.password);
  const snapshot = readSnapshot();

  if (snapshot.users.some((user) => user.account === account)) {
    throw new Error('账号已存在，请直接登录');
  }

  const nextUser: BrowserAuthUserRecord = {
    account,
    name,
    role,
    password
  };

  writeSnapshot({
    users: [...snapshot.users, nextUser],
    currentAccount: account
  });

  return toPublicUser(nextUser);
}

export function loginBrowserUser(payload: { account: string; password: string }): AuthUserProfile {
  const account = normalizeRequiredText(payload.account, '登录账号不能为空');
  const password = normalizePassword(payload.password);
  const snapshot = readSnapshot();
  const matchedUser = snapshot.users.find((user) => user.account === account);

  if (!matchedUser || matchedUser.password !== password) {
    throw new Error('账号或密码不正确');
  }

  writeSnapshot({
    users: snapshot.users,
    currentAccount: matchedUser.account
  });

  return toPublicUser(matchedUser);
}

export function logoutBrowserUser(): AuthOkResult {
  const snapshot = readSnapshot();
  writeSnapshot({
    users: snapshot.users,
    currentAccount: null
  });
  return { ok: true };
}
