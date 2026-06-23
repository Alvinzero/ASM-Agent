import type { AuthLoginPayload, AuthRegisterPayload } from './UserAuthTypes';

export function readAuthLoginPayload(payload: unknown, context = 'auth:login'): AuthLoginPayload {
  if (!isRecord(payload)) {
    throw new Error(`${context} payload must be an object.`);
  }

  if (typeof payload.account !== 'string') {
    throw new Error(`${context} payload.account must be a string.`);
  }

  if (typeof payload.password !== 'string') {
    throw new Error(`${context} payload.password must be a string.`);
  }

  return {
    account: payload.account,
    password: payload.password
  };
}

export function readAuthRegisterPayload(payload: unknown, context = 'auth:register'): AuthRegisterPayload {
  const loginPayload = readAuthLoginPayload(payload, context);

  if (!isRecord(payload)) {
    throw new Error(`${context} payload must be an object.`);
  }

  if (typeof payload.name !== 'string') {
    throw new Error(`${context} payload.name must be a string.`);
  }

  if (typeof payload.role !== 'string') {
    throw new Error(`${context} payload.role must be a string.`);
  }

  return {
    ...loginPayload,
    name: payload.name,
    role: payload.role
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
