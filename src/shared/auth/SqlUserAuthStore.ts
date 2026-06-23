import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { AuthLoginPayload, AuthOkResult, AuthRegisterPayload, AuthUserProfile } from './UserAuthTypes';

interface UserRow {
  account: string;
  name: string;
  role: string;
  password_hash: string;
  password_salt: string;
}

interface CurrentAccountRow {
  value: string;
}

export class SqlUserAuthStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        account TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );
      CREATE TABLE IF NOT EXISTS auth_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  getCurrentUser(): AuthUserProfile | null {
    const state = this.db.prepare('SELECT value FROM auth_state WHERE key = ?').get('current_account');
    if (!isCurrentAccountRow(state)) return null;

    return this.findPublicUser(state.value);
  }

  registerUser(payload: AuthRegisterPayload): AuthUserProfile {
    const account = normalizeRequiredText(payload.account, '登录账号不能为空');
    const name = normalizeRequiredText(payload.name, '姓名不能为空');
    const role = normalizeRequiredText(payload.role, '岗位不能为空');
    const password = normalizePassword(payload.password);

    if (this.findUserRow(account)) {
      throw new Error('账号已存在，请直接登录');
    }

    const passwordSalt = randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, passwordSalt);
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO users (account, name, role, password_hash, password_salt, created_at, updated_at, last_login_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `
      )
      .run(account, name, role, passwordHash, passwordSalt, now, now, now);
    this.setCurrentAccount(account);

    return { account, name, role };
  }

  loginUser(payload: AuthLoginPayload): AuthUserProfile {
    const account = normalizeRequiredText(payload.account, '登录账号不能为空');
    const password = normalizePassword(payload.password);
    const row = this.findUserRow(account);

    if (!row || !verifyPassword(password, row.password_salt, row.password_hash)) {
      throw new Error('账号或密码不正确');
    }

    this.db.prepare('UPDATE users SET last_login_at = ? WHERE account = ?').run(new Date().toISOString(), account);
    this.setCurrentAccount(account);

    return toPublicUser(row);
  }

  logoutUser(): AuthOkResult {
    this.db.prepare('DELETE FROM auth_state WHERE key = ?').run('current_account');
    return { ok: true };
  }

  close(): void {
    this.db.close();
  }

  private findPublicUser(account: string): AuthUserProfile | null {
    const row = this.findUserRow(account);
    return row ? toPublicUser(row) : null;
  }

  private findUserRow(account: string): UserRow | null {
    const row = this.db
      .prepare('SELECT account, name, role, password_hash, password_salt FROM users WHERE account = ?')
      .get(account);
    return isUserRow(row) ? row : null;
  }

  private setCurrentAccount(account: string): void {
    this.db
      .prepare(
        `
        INSERT INTO auth_state (key, value)
        VALUES ('current_account', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `
      )
      .run(account);
  }
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

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString('hex');
}

function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function toPublicUser(row: UserRow): AuthUserProfile {
  return {
    account: row.account,
    name: row.name,
    role: row.role
  };
}

function isUserRow(value: unknown): value is UserRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.account === 'string' &&
    typeof row.name === 'string' &&
    typeof row.role === 'string' &&
    typeof row.password_hash === 'string' &&
    typeof row.password_salt === 'string'
  );
}

function isCurrentAccountRow(value: unknown): value is CurrentAccountRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return typeof (value as Record<string, unknown>).value === 'string';
}
