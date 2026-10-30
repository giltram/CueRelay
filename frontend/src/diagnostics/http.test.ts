import { afterEach, expect, it, vi } from 'vitest';
import { diagnosticFetch } from './http';
import { diagnostics } from './index';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it('correlates successful and conflicting responses without observing bodies or credentials', async () => {
  const record = vi.spyOn(diagnostics, 'record');
  const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 409 })); vi.stubGlobal('fetch', fetch);
  await diagnosticFetch('/api/organizations/1/projects/2/document?token=private', { method: 'PUT', headers: { Authorization: 'Bearer private' }, body: '{"password":"private"}' });
  const calls = record.mock.calls; expect(calls).toHaveLength(2);
  expect(calls[0][3]?.requestId).toBe(calls[1][3]?.requestId);
  expect(calls[1][2]).toBe('conflict'); expect(calls[1][3]?.status).toBe(409);
  const result = await diagnostics.collect(); expect(JSON.stringify(result.events)).not.toContain('private');
});
it('lost responses report unknown results; explicit cancellation remains separate', async () => {
  const record = vi.spyOn(diagnostics, 'record'); vi.stubGlobal('fetch', vi.fn().mockRejectedValue(TypeError('secret')));
  await expect(diagnosticFetch('/api/ass/import', { method: 'POST' })).rejects.toThrow();
  expect(record.mock.calls.at(-1)?.[2]).toBe('unknown'); expect(record.mock.calls.at(-1)?.[3]?.reason).toBe('no_response_result_unknown');
  const controller = new AbortController(); controller.abort();
  await expect(diagnosticFetch('/api/ass/export', { signal: controller.signal })).rejects.toThrow();
  expect(record.mock.calls.at(-1)?.[2]).toBe('cancelled');
});
