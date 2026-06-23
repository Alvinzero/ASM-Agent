export interface AuthUserProfile {
  account: string;
  name: string;
  role: string;
}

export interface AuthLoginPayload {
  account: string;
  password: string;
}

export interface AuthRegisterPayload extends AuthLoginPayload {
  name: string;
  role: string;
}

export interface AuthOkResult {
  ok: true;
}
