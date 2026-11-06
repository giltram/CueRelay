// Real Chrome, isolated HTTP fixtures; no development database writes.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import defaults from '../../shared/timing-shortcuts.json' with { type: 'json' };

const baseURL = process.env.HANDBOOK_URL || 'http://127.0.0.1:5198';
const artifacts = process.env.HANDBOOK_ARTIFACTS || '/tmp/cuerelay-handbook';
mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
context.setDefaultTimeout(10000);
const errors = [], unexpected = [], markdownRequests = [];
context.on('request', request => {
  if (/\.md(?:$|\?)/.test(new URL(request.url()).pathname + new URL(request.url()).search)) markdownRequests.push(request.url());
});
const users = [{ id: 1, username: 'new-user', is_dev: false }, { id: 2, username: 'another-new-user', is_dev: false },
  { id: 3, username: 'existing-user', is_dev: false }];
const seen = new Map([[1, false], [2, false], [3, true]]);
let actor = null, failNextConfirmation = true, confirmations = 0;
let organizations = [{ id: 7, name: '字幕组', role: 'member', can_manage: false }];
let finishConfirmation;
await context.route('**/api/**', async route => {
  const req = route.request(), path = new URL(req.url()).pathname, method = req.method();
  if (path === '/api/auth/session') return route.fulfill({ json: { user: actor } });
  if (path === '/api/auth/login') {
    actor = users.find(user => user.username === req.postDataJSON().username);
    return route.fulfill({ json: { user: actor } });
  }
  if (path === '/api/me/settings' && method === 'GET') return route.fulfill({ json: {
    handbook_seen: seen.get(actor.id), shortcut_overrides: {}, audio_display_mode: 'spectrum', mouse_sets_cue_boundary: true, defaults,
  } });
  if (path === '/api/organizations') return route.fulfill({ json: { organizations } });
  if (path === '/api/organizations/7/projects' && method === 'GET') {
    return route.fulfill({ json: { projects: [], total: 0, page: 1, has_more: false } });
  }
  if (path === '/api/me/handbook' && method === 'POST') {
    confirmations++;
    assert.deepEqual(req.postDataJSON(), {});
    assert.equal(req.headers()['x-cuerelay-user'], String(actor.id));
    if (failNextConfirmation) {
      failNextConfirmation = false;
      await new Promise(resolve => { finishConfirmation = resolve; });
      return route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: '测试保存失败' } } });
    }
    seen.set(actor.id, true);
    return route.fulfill({ json: { handbook_seen: true } });
  }
  unexpected.push(`${method} ${path}`);
  return route.abort();
});
context.on('page', page => page.on('pageerror', error => errors.push(String(error))));
const prompt = page => page.getByRole('dialog', { name: '开始使用 CueRelay', exact: true });
async function open(link) {
  assert.equal(await link.getAttribute('target'), '_blank');
  const waiting = context.waitForEvent('page');
  await link.click();
  const page = await waiting;
  await page.getByRole('article', { name: 'CueRelay 使用手册' }).waitFor();
  assert.equal(await page.evaluate(() => window.opener), null);
  return page;
}
try {
  const page = await context.newPage();
  await page.goto('/organizations/7/projects');
  await page.getByLabel('用户名', { exact: true }).fill('new-user');
  await page.getByLabel('密码', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await prompt(page).waitFor();
  await page.screenshot({ path: `${artifacts}/prompt.png` });

  // Pending/failed confirmation never blocks the user; a later login can retry.
  await prompt(page).getByRole('button', { name: '稍后阅读' }).click();
  await prompt(page).waitFor({ state: 'detached' });
  assert(await page.getByRole('searchbox', { name: '搜索项目' }).isEnabled());
  await page.keyboard.press('Escape');
  assert.equal(confirmations, 1);
  finishConfirmation();
  await page.getByText('未能记住手册提示', { exact: false }).waitFor();
  assert.equal(seen.get(1), false);
  await page.reload();
  await prompt(page).waitFor();

  const handbook = await open(prompt(page).getByRole('link', { name: '打开使用手册' }));
  await prompt(page).waitFor({ state: 'detached' });
  assert.equal(new URL(page.url()).pathname, '/organizations/7/projects');
  assert.equal(new URL(handbook.url()).pathname, '/organizations/7/handbook');
  assert.equal(seen.get(1), true);
  assert.equal(await prompt(handbook).count(), 0);
  const article = handbook.getByRole('article');
  assert.equal(await article.locator('section').count(), 6);
  assert(!(await article.innerText()).includes('**'), 'Markdown emphasis must render instead of displaying delimiters');
  for (const phrase of ['未应用的时间输入', '音频试听时视频画面', '没有自动保存', '拆分会立即保存', 'Aegisub 用户速查', 'UTF-8']) {
    assert((await article.innerText()).includes(phrase), phrase);
  }
  for (const anchor of await handbook.getByRole('navigation', { name: '手册目录' }).getByRole('link').all()) {
    const id = (await anchor.getAttribute('href')).slice(1);
    assert.equal(await article.locator(`[id="${id}"]`).count(), 1);
  }
  await handbook.getByRole('navigation', { name: '手册目录' }).getByRole('link', { name: 'Aegisub 用户速查' }).click();
  await handbook.waitForFunction(() => document.querySelector('#aegisub').getBoundingClientRect().top < 200);
  await handbook.reload();
  await article.waitFor();
  assert.equal(await prompt(handbook).count(), 0);
  await handbook.evaluate(() => window.scrollTo(0, 0));
  await handbook.screenshot({ path: `${artifacts}/desktop.png`, fullPage: true });
  await handbook.setViewportSize({ width: 390, height: 844 });
  assert(await handbook.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await handbook.screenshot({ path: `${artifacts}/mobile.png`, fullPage: true });

  // Opening the same manual from personal settings keeps all inputs in the source tab.
  await page.goto('/organizations/7/settings/personal');
  await page.getByLabel('旧密码', { exact: true }).fill('unsaved-fixture-input');
  const reopened = await open(page.getByRole('region', { name: '使用手册' }).getByRole('link', { name: '打开使用手册' }));
  assert.equal(await page.getByLabel('旧密码', { exact: true }).inputValue(), 'unsaved-fixture-input');
  assert.equal(new URL(reopened.url()).pathname, '/organizations/7/handbook');
  assert.equal(await reopened.getByRole('article').innerText(), await article.innerText());
  await page.reload();
  await page.getByLabel('旧密码', { exact: true }).waitFor();
  assert.equal(await prompt(page).count(), 0);

  // Account state is isolated; direct handbook links don't open a prompt over the manual.
  actor = users[1]; organizations = [];
  await page.goto('/handbook');
  await page.getByRole('article').waitFor();
  assert.equal(await prompt(page).count(), 0);
  assert.equal(seen.get(2), false);
  await page.goto('/settings');
  await prompt(page).waitFor();
  await page.keyboard.press('Escape');
  await prompt(page).waitFor({ state: 'detached' });
  assert.equal(seen.get(2), true);
  const noOrganizationHandbook = await open(page.getByRole('region', { name: '使用手册' }).getByRole('link', { name: '打开使用手册' }));
  assert.equal(new URL(noOrganizationHandbook.url()).pathname, '/handbook');
  await page.reload();
  await page.getByLabel('旧密码', { exact: true }).waitFor();
  assert.equal(await prompt(page).count(), 0);
  actor = users[2];
  await page.goto('/settings');
  await page.getByLabel('旧密码', { exact: true }).waitFor();
  assert.equal(await prompt(page).count(), 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  if (process.env.HANDBOOK_PRODUCTION === '1') assert.deepEqual(markdownRequests, []);
  console.log(JSON.stringify({ browser: browser.version(), confirmations, firstLogin: true, failedRetry: true,
    newTab: true, settingsEntry: true, accountIsolation: true, noOrganization: true, responsive: true,
    markdownRequests, artifacts, errors, unexpected }, null, 2));
} finally {
  await browser.close();
}
