import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccountApi, ApiError, type AccountApi } from './api';
import { diagnostics } from '../diagnostics';

describe('session API boundary', () => {
  let client: AccountApi;
  const expired = vi.fn();
  beforeEach(() => {
    expired.mockReset(); client = createAccountApi(expired);
    vi.stubGlobal('document', { cookie: 'csrftoken=rotated-token' });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it('sends the current CSRF cookie and expected account without storing a session id', async () => {
    client.expectUser(7);
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ user: { id: 7 } }) });
    vi.stubGlobal('fetch', fetch);
    await client.request('/me/settings', 'PATCH', { shortcut_overrides: {} });
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', cache: 'no-store',
      headers: { 'x-csrftoken': 'rotated-token', 'x-cuerelay-user': '7' } });
  });
  it.each(['permission_denied', 'csrf_failed'])('does not expire a session for %s', async code => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { code, message: code } }) }));
    await expect(client.request('/organizations/1')).rejects.toBeInstanceOf(ApiError);
    expect(expired).not.toHaveBeenCalled();
  });
  it.each(['authentication_required', 'account_changed'])('requests reauthentication for %s', async code => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { code, message: code } }) }));
    await expect(client.request('/organizations')).rejects.toThrow(code);
    expect(expired).toHaveBeenCalledOnce();
  });
  it('discards asynchronous responses from a previous account context', async () => {
    client.expectUser(1);
    let resolve!: (value: unknown) => void;
    vi.stubGlobal('fetch', () => new Promise(done => { resolve = done; }));
    const pending = client.request('/me/settings');
    client.expectUser(2);
    resolve({ ok: true, json: async () => ({ shortcut_overrides: { commit: [] } }) });
    await expect(pending).rejects.toMatchObject({ code: 'request_superseded' });
  });
  it('does not let background session observations supersede a pending login', async () => {
    vi.spyOn(diagnostics, 'identify').mockResolvedValue();
    vi.spyOn(diagnostics, 'scope').mockReturnValue(0);
    let resolveLogin!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn((path: string) => path.endsWith('/auth/login')
      ? new Promise(done => { resolveLogin = done; })
      : Promise.resolve({ ok: true, json: async () => ({ user: null }) })));
    const login = client.signIn('admin', 'test-password');
    const observation = client.session().catch(reason => reason);
    resolveLogin({ ok: true, json: async () => ({ user: { id: 1 } }) });
    await expect(login).resolves.toEqual({ user: { id: 1 } });
    expect(await observation).toMatchObject({ code: 'request_superseded' });
  });
  it('still rejects a session observation started before a login', async () => {
    vi.spyOn(diagnostics, 'identify').mockResolvedValue();
    vi.spyOn(diagnostics, 'scope').mockReturnValue(0);
    let resolveSession!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn((path: string) => path.endsWith('/auth/session')
      ? new Promise(done => { resolveSession = done; })
      : Promise.resolve({ ok: true, json: async () => ({ user: { id: 1 } }) })));
    const observation = client.session().catch(reason => reason);
    await client.signIn('admin', 'test-password');
    resolveSession({ ok: true, json: async () => ({ user: null }) });
    expect(await observation).toMatchObject({ code: 'request_superseded' });
    expect(diagnostics.identify).toHaveBeenCalledExactlyOnceWith(1);
  });
  it.each(['response', 'network'])('resumes session checks after a failed login (%s)', async failure => {
    const fetch = vi.fn();
    if (failure === 'network') fetch.mockRejectedValueOnce(new Error('offline'));
    else fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: { code: 'invalid_credentials', message: '登录失败' } }) });
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ user: null }) });
    vi.stubGlobal('fetch', fetch);
    await expect(client.signIn('admin', 'test-password')).rejects.toBeInstanceOf(Error);
    await expect(client.session()).resolves.toEqual({ user: null });
  });
});
