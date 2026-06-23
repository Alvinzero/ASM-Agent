import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SqlUserAuthStore } from '../../src/shared/auth/SqlUserAuthStore';

describe('SqlUserAuthStore', () => {
  const tempRoots: string[] = [];

  function createStore() {
    const root = mkdtempSync(path.join(tmpdir(), 'asm-agent-auth-'));
    tempRoots.push(root);
    return {
      dbPath: path.join(root, 'auth.sqlite'),
      store: new SqlUserAuthStore(path.join(root, 'auth.sqlite'))
    };
  }

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('registers a user, marks it current, and reloads it from the SQL database', () => {
    const { dbPath, store } = createStore();

    const registered = store.registerUser({
      account: 'tangziliang',
      name: '汤子良',
      role: 'ASM 工程师',
      password: 'secret123'
    });

    expect(registered).toEqual({
      account: 'tangziliang',
      name: '汤子良',
      role: 'ASM 工程师'
    });
    expect(store.getCurrentUser()).toEqual(registered);
    store.close();

    const reopened = new SqlUserAuthStore(dbPath);
    expect(reopened.getCurrentUser()).toEqual(registered);
    reopened.close();
  });

  it('rejects duplicate accounts and wrong passwords', () => {
    const { store } = createStore();

    store.registerUser({
      account: 'ligong',
      name: '李工',
      role: '固件开发工程师',
      password: 'secret123'
    });

    expect(() =>
      store.registerUser({
        account: 'ligong',
        name: '另一个李工',
        role: '测试工程师',
        password: 'secret456'
      })
    ).toThrow('账号已存在，请直接登录');
    expect(() => store.loginUser({ account: 'ligong', password: 'wrong-password' })).toThrow('账号或密码不正确');
    expect(store.loginUser({ account: 'ligong', password: 'secret123' })).toEqual({
      account: 'ligong',
      name: '李工',
      role: '固件开发工程师'
    });

    store.close();
  });

  it('validates required account, profile, and password fields before writing SQL rows', () => {
    const { store } = createStore();

    expect(() =>
      store.registerUser({
        account: '',
        name: '张三',
        role: '应用工程师',
        password: 'secret123'
      })
    ).toThrow('登录账号不能为空');
    expect(() =>
      store.registerUser({
        account: 'zhangsan',
        name: '',
        role: '应用工程师',
        password: 'secret123'
      })
    ).toThrow('姓名不能为空');
    expect(() =>
      store.registerUser({
        account: 'zhangsan',
        name: '张三',
        role: '应用工程师',
        password: '123'
      })
    ).toThrow('密码至少需要 6 位');

    expect(store.getCurrentUser()).toBeNull();
    store.close();
  });
});
