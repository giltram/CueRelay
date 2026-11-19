import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccountApi, ApiError, type AccountApi } from './api';
import { diagnostics } from '../diagnostics';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

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
  it.each([
    ['authentication_required', 'session'], ['account_changed', 'session'],
    ['authentication_required', 'login'], ['account_changed', 'login'],
  ])('ignores stale %s after a successful same-account %s', async (code, confirmation) => {
    client.expectUser(1);
    vi.spyOn(diagnostics, 'identify').mockResolvedValue();
    vi.spyOn(diagnostics, 'scope').mockReturnValue(0);
    const pending = deferred<unknown>();
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user: { id: 1 } }) }));
    const request = client.request('/organizations').catch(reason => reason);
    if (confirmation === 'session') await client.session();
    else await client.signIn('admin', 'test-password');
    pending.resolve({ ok: false, json: async () => ({ error: { code, message: code } }) });
    expect(await request).toMatchObject({ code: 'request_superseded' });
    expect(expired).not.toHaveBeenCalled();
  });
  it.each(['authentication_required', 'account_changed'])('ignores stale session %s after a newer confirmed session', async code => {
    vi.spyOn(diagnostics, 'identify').mockResolvedValue();
    vi.spyOn(diagnostics, 'scope').mockReturnValue(0);
    const pending = deferred<unknown>();
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ user: null }) }));
    const first = client.session().catch(reason => reason);
    await client.session();
    pending.resolve({ ok: false, json: async () => ({ error: { code, message: code } }) });
    expect(await first).toMatchObject({ code: 'request_superseded' });
    expect(expired).not.toHaveBeenCalled();
  });
  it('still expires when a newer identity check is only pending', async () => {
    vi.spyOn(diagnostics, 'identify').mockResolvedValue();
    vi.spyOn(diagnostics, 'scope').mockReturnValue(0);
    const old = deferred<unknown>(), checking = deferred<unknown>();
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => old.promise).mockImplementationOnce(() => checking.promise));
    const request = client.request('/organizations').catch(reason => reason);
    const observation = client.session();
    old.resolve({ ok: false, json: async () => ({ error: { code: 'authentication_required', message: 'expired' } }) });
    expect(await request).toMatchObject({ code: 'authentication_required' });
    expect(expired).toHaveBeenCalledOnce();
    checking.resolve({ ok: true, json: async () => ({ user: null }) });
    await observation;
  });
  it('ignores expiration of a protected read started during a subsequently successful session check', async () => {
    vi.spyOn(diagnostics, 'identify').mockResolvedValue();
    vi.spyOn(diagnostics, 'scope').mockReturnValue(0);
    const checking = deferred<unknown>(), reading = deferred<unknown>();
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => checking.promise).mockImplementationOnce(() => reading.promise));
    const observation = client.session();
    const request = client.request('/organizations').catch(reason => reason);
    checking.resolve({ ok: true, json: async () => ({ user: null }) });
    await observation;
    reading.resolve({ ok: false, json: async () => ({ error: { code: 'authentication_required', message: 'expired' } }) });
    expect(await request).toMatchObject({ code: 'request_superseded' });
    expect(expired).not.toHaveBeenCalled();
  });
  it('still expires a request made after successful identity confirmation', async () => {
    vi.spyOn(diagnostics, 'identify').mockResolvedValue();
    vi.spyOn(diagnostics, 'scope').mockReturnValue(0);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ user: null }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: { code: 'authentication_required', message: 'expired' } }) }));
    await client.session();
    await expect(client.request('/organizations')).rejects.toMatchObject({ code: 'authentication_required' });
    expect(expired).toHaveBeenCalledOnce();
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
