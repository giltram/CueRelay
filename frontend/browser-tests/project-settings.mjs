import { uiDocument } from './ass-codec.mjs';
import { unavailableAssPreview } from './ass-preview-fixture.mjs';
// Metadata page and list actions with HTTP fixtures; no development database writes.
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const baseURL = process.env.PROJECT_SETTINGS_URL || 'http://127.0.0.1:5173';
const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-project-settings-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 950 } });
context.setDefaultTimeout(10000);
const errors = [], unexpected = [], writes = [], checks = [];
const user = { id: 1, username: 'settings-fixture', is_dev: false };
const organization = { id: 72, name: '项目设置测试组织', role: 'organizer', can_manage: true };
const listPath = '/organizations/72/projects';
const settingsPath = `${listPath}/5/settings`;
let authenticated = true, failLoad = false, failSave = false;
let project = {
  id: 5, organization_id: 72, name: '原项目名称', description: '原项目说明', status: 'active', revision: 1,
  created_at: '2026-10-24T00:00:00Z', updated_at: '2026-10-24T00:00:00Z', updated_by: user,
  archived_at: null, archived_by: null,
  media: { sha256: 'a'.repeat(64), size: 100, duration_ms: 10000 },
  document: uiDocument(['Default']),
};
context.on('page', page => page.on('pageerror', error => errors.push(String(error))));
await context.route('**/api/**', async route => {
  if (await unavailableAssPreview(route)) return;
  const request = route.request(), url = new URL(request.url()), path = url.pathname.slice(4), method = request.method();
  const reply = json => route.fulfill({ json });
  const failure = (status, code, message) => route.fulfill({ status, json: { error: { code, message } } });
  if (method === 'GET' && path === '/auth/session') return reply({ user: authenticated ? user : null });
  if (method === 'POST' && path === '/auth/login') { authenticated = true; return reply({ user }); }
  if (method === 'GET' && path === '/organizations') return reply({ organizations: [organization] });
  if (method === 'GET' && path === '/me/settings') return reply({ shortcut_overrides: {}, audio_display_mode: 'spectrum' });
  if (method === 'GET' && path === listPath) return reply({ projects: url.searchParams.get('status') === project.status ? [project] : [], total: 1, page: 1, has_more: false });
  if (method === 'GET' && path === `${listPath}/5`) {
    return failLoad ? failure(404, 'not_found', '项目不存在。') : reply({ project });
  }
  if (method === 'PATCH' && path === `${listPath}/5`) {
    const body = request.postDataJSON(); writes.push(body);
    if (failSave) return failure(503, 'unavailable', '保存失败，请重试。');
    if (body.revision !== project.revision) return failure(409, 'project_conflict', '项目已被其他操作更新。');
    project = { ...project, name: body.name.trim(), description: body.description, revision: project.revision + 1 };
    return reply({ project });
  }
  if (method === 'POST' && path === `${listPath}/5/archive`) {
    project = { ...project, status: 'archived', revision: project.revision + 1, archived_at: project.updated_at, archived_by: user };
    return reply({ project });
  }
  unexpected.push(`${method} ${path}`); await route.abort();
});
const page = await context.newPage();
const record = message => { checks.push(message); console.log('PASS', message); };
const field = (tab, label) => tab.getByLabel(label, { exact: true });
const button = (tab, name) => tab.getByRole('button', { name, exact: true });
try {
  await page.goto(listPath);
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: project.name, exact: true }) });
  await row.waitFor();
  assert.equal(await row.locator('details, summary').count(), 0);
  assert.equal(await row.getByRole('link', { name: '打开', exact: true }).count(), 0);
  await row.getByRole('link', { name: '项目设置', exact: true }).waitFor();
  assert(await button(row, '归档项目').isVisible());
  assert.equal(await row.getByRole('link', { name: project.name, exact: true }).getAttribute('href'), `${listPath}/5/workspace`);
  await page.screenshot({ path: join(artifacts, 'active-list-desktop.png'), fullPage: true });
  const opened = context.waitForEvent('page');
  await row.getByRole('link', { name: '项目设置', exact: true }).click();
  const settings = await opened;
  await field(settings, '项目名称').waitFor();
  assert.equal(new URL(settings.url()).pathname, settingsPath);
  assert.equal(new URL(page.url()).pathname, listPath);
  assert.equal(await settings.evaluate(() => window.opener), null);
  assert.equal(await field(settings, '项目名称').inputValue(), project.name);
  assert.equal(await field(settings, '项目说明').inputValue(), project.description);
  assert.equal(await settings.locator('dialog, video, input[type=file]').count(), 0);
  record('操作直接显示项目设置和归档，移除打开按钮；设置在独立新标签页加载名称说明，项目名称继续进入工作区');

  await field(settings, '项目名称').fill('新的项目名称');
  await field(settings, '项目说明').fill('第一行说明\n第二行说明');
  await button(settings, '保存修改').click();
  await settings.getByText('项目设置已保存。', { exact: true }).waitFor();
  assert.deepEqual(writes.at(-1), { name: '新的项目名称', description: '第一行说明\n第二行说明', revision: 1 });
  await settings.reload(); await field(settings, '项目名称').waitFor();
  assert.equal(await field(settings, '项目名称').inputValue(), '新的项目名称');
  assert.equal(await field(settings, '项目说明').inputValue(), '第一行说明\n第二行说明');
  await field(settings, '项目名称').fill(''); await button(settings, '保存修改').click();
  assert.equal(writes.length, 1);
  await field(settings, '项目名称').fill('冲突时保留名称');
  await field(settings, '项目说明').fill('冲突时保留说明');
  project = { ...project, name: '服务器新名称', description: '服务器新说明', revision: project.revision + 1 };
  await button(settings, '保存修改').click();
  await settings.getByRole('alert').filter({ hasText: '项目已被其他操作更新' }).waitFor();
  assert.equal(await field(settings, '项目名称').inputValue(), '冲突时保留名称');
  assert.equal(await field(settings, '项目说明').inputValue(), '冲突时保留说明');
  await button(settings, '刷新项目版本').click();
  await settings.getByText(/当前服务器版本：服务器新名称；说明：服务器新说明/).waitFor();
  assert.equal(await field(settings, '项目名称').inputValue(), '冲突时保留名称');
  assert.equal(await field(settings, '项目说明').inputValue(), '冲突时保留说明');
  failSave = true; await button(settings, '保存修改').click();
  await settings.getByText('保存失败，请重试。', { exact: true }).waitFor();
  assert.equal(await field(settings, '项目说明').inputValue(), '冲突时保留说明');
  failSave = false; await button(settings, '保存修改').click();
  await settings.getByText('项目设置已保存。', { exact: true }).waitFor();
  assert.equal(project.name, '冲突时保留名称');
  record('名称说明保存和刷新持久化，空名称禁止提交；版本冲突和网络失败保留输入，显式刷新后可重试保存');

  for (const width of [1440, 390]) {
    await settings.setViewportSize({ width, height: 950 });
    assert(await settings.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await settings.screenshot({ path: join(artifacts, `settings-${width}.png`), fullPage: true });
  }
  await settings.getByRole('link', { name: '返回项目列表', exact: true }).click();
  await settings.getByRole('link', { name: project.name, exact: true }).waitFor();
  await button(settings, '归档项目').click();
  await button(settings.getByRole('dialog'), '确认归档').click();
  await settings.getByRole('dialog').waitFor({ state: 'hidden' });
  await settings.getByRole('tab', { name: '过去项目', exact: true }).click();
  await button(settings, '恢复项目').waitFor();
  assert.equal(await settings.locator('details, summary').count(), 0);
  assert.equal(await settings.getByRole('link', { name: '只读查看', exact: true }).count(), 0);
  await settings.screenshot({ path: join(artifacts, 'archived-list-mobile.png'), fullPage: true });
  await settings.goto(settingsPath); await field(settings, '项目名称').waitFor();
  await settings.getByText('项目已归档，恢复后才能修改项目设置。', { exact: true }).waitFor();
  assert(await field(settings, '项目名称').isDisabled()); assert(await button(settings, '保存修改').isDisabled());
  record('桌面和窄屏布局无溢出，返回列表展示保存结果，归档与恢复入口直接可见，归档项目设置只读');

  failLoad = true; await settings.reload();
  await settings.getByText('项目不存在。', { exact: true }).waitFor();
  failLoad = false; await button(settings, '重试').click(); await field(settings, '项目名称').waitFor();
  organization.can_manage = false; organization.role = 'member'; await settings.reload();
  await settings.getByText('只有组织管理员可以修改项目设置。', { exact: true }).waitFor();
  assert.equal(await field(settings, '项目名称').count(), 0);
  await page.reload(); await page.getByRole('tab', { name: '过去项目', exact: true }).click();
  await page.getByRole('link', { name: project.name, exact: true }).waitFor();
  assert.equal(await button(page, '恢复项目').count(), 0);
  organization.can_manage = true; organization.role = 'organizer'; project.status = 'active'; authenticated = false;
  await settings.goto(settingsPath);
  await field(settings, '用户名').fill(user.username); await field(settings, '密码').fill('fixture-password');
  await button(settings, '登录').click(); await field(settings, '项目名称').waitFor();
  assert.equal(new URL(settings.url()).pathname, settingsPath);
  assert(await button(settings, '保存修改').isEnabled());
  record('加载失败可重试，普通成员没有管理入口且直达设置不可编辑，登录继续原项目设置深链接');
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log(JSON.stringify({ browser: browser.version(), checks, artifacts, errors, unexpected }, null, 2));
} catch (error) {
  for (const [index, tab] of context.pages().entries()) {
    console.error('TAB', tab.url(), await tab.locator('body').innerText());
    await tab.screenshot({ path: join(artifacts, `failure-${index}.png`), fullPage: true }).catch(() => {});
  }
  throw error;
} finally { await context.close(); await browser.close(); }
