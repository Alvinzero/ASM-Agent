import type { AuthLoginPayload, AuthOkResult, AuthRegisterPayload, AuthUserProfile } from '../../shared/auth/UserAuthTypes';

const CURRENT_USER_ENDPOINT = '/api/auth/current-user';
const LOGIN_ENDPOINT = '/api/auth/login';
const REGISTER_ENDPOINT = '/api/auth/register';
const LOGOUT_ENDPOINT = '/api/auth/logout';

class AuthRequestError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export async function getCurrentUserProfile(): Promise<AuthUserProfile | null> {
  if (window.asmAgent?.getCurrentUser) {
    return window.asmAgent.getCurrentUser();
  }

  try {
    return await fetchAuthJson<AuthUserProfile | null>(CURRENT_USER_ENDPOINT);
  } catch (caught) {
    if (caught instanceof AuthRequestError && caught.status === 404) {
      return null;
    }

    if (caught instanceof ReferenceError) {
      return null;
    }

    if (caught instanceof AuthRequestError) {
      throw caught;
    }

    throw caught;
  }
}

export async function loginUser(payload: AuthLoginPayload): Promise<AuthUserProfile> {
  if (window.asmAgent?.loginUser) {
    return window.asmAgent.loginUser(payload);
  }

  try {
    return await postAuthJson<AuthUserProfile>(LOGIN_ENDPOINT, payload);
  } catch (caught) {
    if (caught instanceof AuthRequestError && caught.status !== 404) {
      throw caught;
    }
    throw new Error('认证服务不可用，请使用 Electron 或开发服务器运行。');
  }
}

export async function registerUser(payload: AuthRegisterPayload): Promise<AuthUserProfile> {
  if (window.asmAgent?.registerUser) {
    return window.asmAgent.registerUser(payload);
  }

  try {
    return await postAuthJson<AuthUserProfile>(REGISTER_ENDPOINT, payload);
  } catch (caught) {
    if (caught instanceof AuthRequestError && caught.status !== 404) {
      throw caught;
    }
    throw new Error('认证服务不可用，请使用 Electron 或开发服务器运行。');
  }
}

export async function logoutUser(): Promise<AuthOkResult> {
  if (window.asmAgent?.logoutUser) {
    return window.asmAgent.logoutUser();
  }

  try {
    return await postAuthJson<AuthOkResult>(LOGOUT_ENDPOINT, {});
  } catch (caught) {
    if (caught instanceof AuthRequestError && caught.status !== 404) {
      throw caught;
    }
    return { ok: true };
  }
}

async function fetchAuthJson<T>(endpoint: string): Promise<T> {
  const response = await fetch(endpoint, {
    headers: { Accept: 'application/json' }
  });
  return readAuthResponse<T>(response);
}

async function postAuthJson<T>(endpoint: string, body: unknown): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  return readAuthResponse<T>(response);
}

async function readAuthResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'error' in payload &&
      typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `认证请求失败：HTTP ${response.status}`;
    throw new AuthRequestError(message, response.status);
  }
  return payload as T;
}
