import type { AuthLoginPayload, AuthOkResult, AuthRegisterPayload, AuthUserProfile } from '../../shared/auth/UserAuthTypes';
import { getBrowserCurrentUser, loginBrowserUser, logoutBrowserUser, registerBrowserUser } from './BrowserAuthStore';

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
      return getBrowserCurrentUser();
    }

    if (caught instanceof ReferenceError) {
      return getBrowserCurrentUser();
    }

    if (caught instanceof AuthRequestError) {
      throw caught;
    }

    return getBrowserCurrentUser();
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
    return loginBrowserUser(payload);
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
    return registerBrowserUser(payload);
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
    return logoutBrowserUser();
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
