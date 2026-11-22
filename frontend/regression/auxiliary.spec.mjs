import { readFile, writeFile } from 'node:fs/promises';
import { test, expect, fixtures, button, login } from './helpers.mjs';

const prompt = page => page.getByRole('dialog', { name: '开始使用 CueRelay', exact: true });
async function confirm(page, action) {
  const pending = page.waitForResponse(r => r.url().endsWith('/api/me/handbook') && r.request().method() === 'POST');
  await action(); const response = await pending;
  expect(response.status()).toBe(200); expect(await response.json()).toEqual({ handbook_seen: true });
  expect(response.request().postDataJSON()).toEqual({});
  await expect(prompt(page)).toHaveCount(0);
}
async function exportDiagnostics(page) {
  const downloaded = page.waitForEvent('download');
  await button(page, '导出诊断信息').click();
  const file = await downloaded; expect(await file.failure()).toBeNull();
  expect(file.suggestedFilename()).toMatch(/^cuerelay-diagnostics-.*\.json$/);
  return JSON.parse(await readFile(await file.path(), 'utf8'));
}

test('auxiliary first handbook acknowledgement persists per real account', async ({ page, browser }) => {
  await login(page);
  await expect(prompt(page)).toBeVisible();
  expect((await (await page.request.get('/api/me/settings')).json()).handbook_seen).toBe(false);
  await confirm(page, () => button(prompt(page), '稍后阅读').click());
  await page.reload(); await expect(page.getByLabel('旧密码', { exact: true })).toBeVisible();
  await expect(prompt(page)).toHaveCount(0);
  expect((await (await page.request.get('/api/me/settings')).json()).handbook_seen).toBe(true);
  const other = await browser.newContext({ baseURL: new URL(page.url()).origin, locale: 'zh-CN' });
  const errors = [];
  other.on('page', tab => tab.on('pageerror', error => errors.push(String(error))));
  try {
    const tab = await other.newPage(); await login(tab, '/settings', fixtures.organizer);
    await expect(prompt(tab)).toBeVisible();
    expect((await (await tab.request.get('/api/me/settings')).json()).handbook_seen).toBe(false);
    const popup = tab.waitForEvent('popup');
    const link = prompt(tab).getByRole('link', { name: '打开使用手册', exact: true });
    await expect(link).toHaveAttribute('target', '_blank');
    await confirm(tab, () => link.click());
    const manual = await popup;
    await expect(manual.getByRole('article', { name: 'CueRelay 使用手册' })).toBeVisible();
    expect(await manual.evaluate(() => window.opener)).toBeNull();
    await tab.reload(); await expect(tab.getByLabel('旧密码', { exact: true })).toBeVisible();
    await expect(prompt(tab)).toHaveCount(0);
    expect((await (await tab.request.get('/api/me/settings')).json()).handbook_seen).toBe(true);
  } finally { await other.close(); expect(errors).toEqual([]); }
});

test('auxiliary business error diagnostic download correlates safe backend log and account', async ({ page }) => {
  await login(page);
  const wrong = 'isolated-wrong-password-do-not-record';
  await page.getByLabel('旧密码', { exact: true }).fill(wrong);
  await page.getByLabel('新密码', { exact: true }).fill('isolated-new-password-928!');
  await page.getByLabel('确认新密码', { exact: true }).fill('isolated-new-password-928!');
  const failed = page.waitForResponse(r => r.url().endsWith('/api/auth/password') && r.request().method() === 'POST');
  await button(page, '修改密码').click();
  const response = await failed; expect(response.status()).toBe(400);
  const id = response.headers()['x-request-id'];
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  expect(response.request().headers()['x-request-id']).toBe(id);
  await expect(page.getByText('旧密码不正确。', { exact: true })).toBeVisible();
  const report = await exportDiagnostics(page);
  expect(report.metadata.formatVersion).toBe(1);
  expect(report.environment.account).toMatchObject({ id: fixtures.memberId, username: fixtures.username, is_dev: false });
  expect(Object.keys(report.environment.account).sort()).toEqual(['id', 'is_dev', 'organization', 'username']);
  const event = report.events.find(event => event.module === 'http' && event.data.requestId === id && event.data.status === 400);
  expect(event).toMatchObject({ action: 'request', outcome: 'error', data: { method: 'POST', route: '/api/auth/password' } });
  expect(Object.keys(event.data).sort()).toEqual(['durationMs', 'method', 'requestId', 'route', 'status']);
  const serialized = JSON.stringify(report);
  for (const secret of [wrong, fixtures.password, 'isolated-new-password-928!', 'csrftoken', 'sessionid', fixtures.video]) expect(serialized).not.toContain(secret);
  // Real logout/login in the same origin clears the recorder fence; no private source data is used.
  await button(page, '退出账号').click();
  await page.getByLabel('用户名', { exact: true }).fill(fixtures.organizer);
  await page.getByLabel('密码', { exact: true }).fill(fixtures.password);
  const loggedIn = page.waitForResponse(r => r.url().endsWith('/api/auth/login') && r.status() === 200);
  await button(page, '登录').click(); await loggedIn;
  await expect(page.getByLabel('用户名', { exact: true })).toHaveCount(0);
  await page.goto('/settings');
  await expect(page.getByLabel('旧密码', { exact: true })).toBeVisible();
  const isolated = await exportDiagnostics(page);
  expect(isolated.environment.account.username).toBe(fixtures.organizer);
  expect(JSON.stringify(isolated)).not.toContain(id);
  expect(isolated.events.some(event => event.data.route === '/api/auth/password')).toBe(false);
  await writeFile(fixtures.diagnosticReport, JSON.stringify({ id, report, isolated }, null, 2));
});
