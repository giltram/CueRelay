import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { accountStatus, diagnostics, provideAccountStatus } from './index';
import { diagnosticFilename, diagnosticReport } from './export';
import { LIMITS, type AccountStatus } from './schema';

const account: AccountStatus = { id: 7, username: '测试用户', is_dev: true,
  organization: { id: 3, name: '字幕组', role: 'member', can_manage: true } };
let cleanup: (() => void) | undefined;
beforeEach(() => {
  vi.spyOn(diagnostics, 'scope').mockReturnValue(1);
  vi.spyOn(diagnostics, 'isOwner').mockImplementation(id => id === 7);
  vi.spyOn(diagnostics, 'contextSnapshot').mockReturnValue({ page: 'local', organizationId: 3 });
  vi.spyOn(diagnostics, 'collect').mockResolvedValue({ events: [], coverage: {
    storage: 'indexeddb', storageFailure: null, accountIsolated: true, evicted: 0, truncated: 0, limits: LIMITS,
  } });
  for (const [key, value] of Object.entries({ navigator: { userAgent: 'Chrome/1', onLine: true },
    innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1, isSecureContext: true, crossOriginIsolated: false })) vi.stubGlobal(key, value);
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('exports only allowed account fields and uses the same identity and timestamp in the filename', async () => {
  const withSecrets = { ...account, password: 'private-password', token: 'private-token',
    organization: { ...account.organization!, cookie: 'private-cookie' } };
  cleanup = provideAccountStatus(7, () => withSecrets);
  const report = await diagnosticReport();
  expect(report.environment.account).toEqual(account);
  const serialized = JSON.stringify(report);
  for (const secret of ['private-password', 'private-token', 'private-cookie']) expect(serialized).not.toContain(secret);
  expect(diagnosticFilename(report)).toBe(`cuerelay-diagnostics-测试用户-id-7-dev-member-${report.environment.exportedAt.replace(/[:.]/g, '-')}.json`);
});

it('hides old account metadata when ownership, scope or isolation is lost', async () => {
  cleanup = provideAccountStatus(7, () => account);
  vi.mocked(diagnostics.isOwner).mockReturnValue(false);
  expect((await diagnosticReport()).environment.account).toBeNull();
  vi.mocked(diagnostics.isOwner).mockReturnValue(true);
  vi.mocked(diagnostics.scope).mockReturnValue(2);
  expect((await diagnosticReport()).environment.account).toBeNull();
});

it('omits organization permissions outside their organization and reflects changed roles', () => {
  let current = account;
  cleanup = provideAccountStatus(7, () => current);
  current = { ...account, organization: { ...account.organization!, role: 'organizer' } };
  expect(accountStatus()?.organization?.role).toBe('organizer');
  vi.mocked(diagnostics.contextSnapshot).mockReturnValue({ page: 'local', organizationId: 4 });
  expect(accountStatus()).toEqual({ ...account, organization: null });
});

it('exports unavailable identity without guessing a username or role', async () => {
  const report = await diagnosticReport();
  expect(report.environment.account).toBeNull();
  expect(diagnosticFilename(report)).toContain('-account-unavailable-');
  expect(report.summary.missingInformation.some(text => text.includes('用户信息不可用'))).toBe(true);
});

it('keeps filenames safe and bounded while preserving the username in JSON', async () => {
  const username = '../用户/:*?"<>|\\\n'.repeat(15);
  cleanup = provideAccountStatus(7, () => ({ ...account, username, is_dev: false, organization: null }));
  const report = await diagnosticReport();
  expect(report.environment.account?.username).toBe(username.slice(0, 150));
  const filename = diagnosticFilename(report);
  expect(filename).not.toMatch(/[/:*?"<>|\\\n]/);
  expect(new TextEncoder().encode(filename).length).toBeLessThan(255);
  expect(filename).toContain('-id-7-user-');
});
