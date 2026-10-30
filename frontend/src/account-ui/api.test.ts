import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccountApi, ApiError, type AccountApi } from './api';

describe('session API boundary', () => {
  let client: AccountApi;
  const expired = vi.fn();
  beforeEach(() => {
    expired.mockReset(); client = createAccountApi(expired);
    vi.stubGlobal('document', { cookie: 'csrftoken=rotated-token' });
  });
  afterEach(() => { vi.unstubAllGlobals(); });
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
});
