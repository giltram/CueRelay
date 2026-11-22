import { test, expect, fixtures, button, text, openWorkspace, readProject, saveDocument, request } from './helpers.mjs';
import { writes, localDraft, retained, drafts } from './failure-helpers.mjs';

// Transport timeout is an injected browser transport error, not a product deadline.
// The client has no automatic write deadline/retry contract. Never pretend these committed.
test('network offline timeout and unavailable writes retain drafts until explicit save', async ({ page, context }) => {
  await openWorkspace(page);
  const initial = await readProject(page), observed = writes(page, 'document');
  const before = await localDraft(page, '网络故障本机稿', '0:00:');
  await context.setOffline(true);
  await button(page, '保存项目').click();
  await expect(page.getByRole('alert')).toContainText('操作结果未知');
  await retained(page, before, '网络故障本机稿', '0:00:');
  await context.setOffline(false); expect(await readProject(page)).toEqual(initial);
  expect(observed.map(body => body.revision)).toEqual([1]);
  for (const fault of ['timedout', '503']) {
    await page.route(`**${fixtures.projectPath}/document`, route => fault === 'timedout'
      ? route.abort('timedout') : route.fulfill({ status: 503, json: { error: {
        code: 'server_error', message: '服务暂时不可用', reason: 'server.serviceUnavailable', params: {},
      } } }), { times: 1 });
    await button(page, '保存项目').click();
    await expect(page.getByRole('alert')).toContainText(fault === 'timedout' ? '操作结果未知' : '服务暂时不可用');
    await retained(page, before, '网络故障本机稿', '0:00:');
    expect(await readProject(page)).toEqual(initial);
  }
  expect(observed.map(body => body.revision)).toEqual([1, 1, 1]);
  const saved = await saveDocument(page, 1);
  expect(saved.document.cues[0].text).toBe('网络故障本机稿');
  expect(saved.document.cues[0].start_ms).toBe(0);
  expect(observed.map(body => body.revision)).toEqual([1, 1, 1, 1]);
  // Unapplied time remains a separate local draft after acknowledged document save.
  await expect.poll(() => drafts(page)).toMatchObject([{ baseRevision: 2, timing: { startText: '0:00:' } }]);
});

test('network real session expiration preserves editor and same account resumes save', async ({ page, context }) => {
  await openWorkspace(page);
  const original = await readProject(page), observed = writes(page, 'document');
  const before = await localDraft(page, '会话失效保留正文', '0:00:');
  // Delete the actual Django session via a separate request sharing this browser's cookies.
  expect((await request(context, '/api/auth/logout', 'POST', {})).status()).toBe(200);
  await button(page, '保存项目').click();
  await expect(page.getByLabel('用户名', { exact: true })).toBeVisible();
  await expect(text(page)).toHaveValue('会话失效保留正文');
  expect(await drafts(page)).toEqual(before.records);
  await page.getByLabel('用户名', { exact: true }).fill(fixtures.username);
  await page.getByLabel('密码', { exact: true }).fill(fixtures.password);
  await button(page, '登录').click();
  await expect(text(page)).toBeEditable();
  await retained(page, before, '会话失效保留正文', '0:00:');
  expect(await readProject(page)).toEqual(original);
  expect(observed.map(body => body.revision)).toEqual([1]);
  await saveDocument(page, 1);
  expect(observed.map(body => body.revision)).toEqual([1, 1]);
});

test('network revoked project access recovers after real membership restoration', async ({ page, browser }) => {
  await openWorkspace(page);
  const original = await readProject(page), observed = writes(page, 'document');
  const before = await localDraft(page, '撤权恢复保留正文', '0:00:');
  const organizer = await browser.newContext({ baseURL: new URL(page.url()).origin, locale: 'zh-CN' });
  try {
    await organizer.request.get('/api/auth/session');
    expect((await request(organizer, '/api/auth/login', 'POST', { username: fixtures.organizer, password: fixtures.password })).status()).toBe(200);
    expect((await request(organizer, fixtures.membershipPath, 'DELETE', {})).status()).toBe(200);
    const denied = page.waitForResponse(r => new URL(r.url()).pathname === fixtures.projectPath && r.status() === 403);
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await denied;
    await expect(text(page)).toBeDisabled();
    await retained(page, before, '撤权恢复保留正文', '0:00:');
    expect(observed).toEqual([]);
    const membersPath = fixtures.membershipPath.replace(/\/\d+$/, '');
    expect((await request(organizer, membersPath, 'POST', { username: fixtures.username })).status()).toBe(200);
    const restored = page.waitForResponse(r => new URL(r.url()).pathname === fixtures.projectPath && r.status() === 200);
    await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await restored;
    await expect(text(page)).toBeEditable();
    await retained(page, before, '撤权恢复保留正文', '0:00:');
    expect(await readProject(page)).toEqual(original); expect(observed).toEqual([]);
    await saveDocument(page, 1); expect(observed.map(body => body.revision)).toEqual([1]);
  } finally { await organizer.close(); }
});
