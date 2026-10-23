export interface User { id: number; username: string; is_dev: boolean }
export interface Organization { id: number; name: string; role: 'organizer' | 'member' | null; can_manage: boolean }
export interface Member { id: number; user_id: number; username: string; role: 'organizer' | 'member'; is_active: boolean }
export type Overrides = Partial<Record<import('../workspace-ui/timing-shortcuts').TimingShortcut, string[]>>;
export interface Settings { shortcut_overrides: Overrides }
export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
export type AccountRequest = import('../contracts/http').JsonRequest;
export type AccountApi = ReturnType<typeof createAccountApi>;

/** One explicit client per App; identity never lives in shared module state. */
export function createAccountApi(onExpired: () => void) {
  let expectedUser: number | null = null;
  const request: AccountRequest = async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    // Only the CSRF cookie is readable. Session ID remains HttpOnly.
    const token = document.cookie.split('; ').find(value => value.startsWith('csrftoken='))?.slice(10) || '';
    const actor = expectedUser;
    const protectedRequest = !['/auth/session', '/auth/login'].includes(path);
    const headers: Record<string, string> = method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRFToken': token };
    if (protectedRequest && actor !== null) headers['X-CueRelay-User'] = String(actor);
    const response = await fetch(`/api${path}`, {
      method, credentials: 'same-origin', cache: 'no-store', headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json();
    if (protectedRequest && actor !== expectedUser) throw new ApiError('request_superseded', '账号上下文已变更，请重试。');
    if (!response.ok) {
      const error = new ApiError(value.error?.code || 'request_failed', value.error?.message || '请求失败');
      if (['authentication_required', 'account_changed'].includes(error.code)) onExpired();
      throw error;
    }
    return value as T;
  };
  return {
    request,
    expectUser: (id: number | null) => { expectedUser = id; },
    session: () => request<{ user: User | null }>('/auth/session'),
    signIn: (username: string, password: string) => request<{ user: User }>('/auth/login', 'POST', { username, password }),
  };
}
