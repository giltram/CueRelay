// Real App with isolated HTTP fixtures; no development database writes.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext();
await context.addInitScript(() => {
  Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
  const original = window.setInterval;
  window.setInterval = (callback, delay, ...args) => {
    if (delay === 30000) window.checkSessionInterval = () => callback(...args);
    return original(callback, delay, ...args);
  };
});
const page = await context.newPage();
page.setDefaultTimeout(5000);
const errors = [], pending = [];
page.on('pageerror', error => errors.push(String(error)));
let organizations = [{ id: 1, name: 'Fixture organization', role: 'organizer', can_manage: true }];
const project = {
  id: 7, organization_id: 1, name: 'Original project', description: '', status: 'active', revision: 1,
  created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
  updated_by: { username: 'fixture' }, archived_at: null, archived_by: null,
};
const listPath = '/api/organizations/1/projects';
await context.route('**/api/**', route => {
  const path = new URL(route.request().url()).pathname;
  if (path === listPath) { pending.push(route); return; }
  const fixtures = {
    '/api/auth/session': { user: { id: 1, username: 'fixture', is_dev: false } },
    '/api/organizations': { organizations },
    '/api/me/settings': { shortcut_overrides: {}, audio_display_mode: 'spectrum', mouse_sets_cue_boundary: true, handbook_seen: true },
  };
  assert.ok(fixtures[path], `unexpected HTTP ${path}`);
  return route.fulfill({ json: fixtures[path] });
});
async function nextList() {
  for (let attempt = 0; attempt < 250; attempt++) {
    if (pending.length) return pending.shift();
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('expected a project list request');
}
async function complete(route, name = 'Original project', total = 26) {
  const url = new URL(route.request().url());
  const number = Number(url.searchParams.get('page'));
  await route.fulfill({ json: { projects: [{ ...project, name, status: url.searchParams.get('status') }],
    total, page: number, has_more: number < Math.ceil(total / 25) } });
  await page.getByRole('link', { name, exact: true }).waitFor();
}
const notice = page.getByText('正在加载项目…', { exact: true });
const next = page.getByRole('button', { name: '下一页', exact: true });
const previous = page.getByRole('button', { name: '上一页', exact: true });
async function observe(event) {
  await page.evaluate(event => {
    if (event === 'interval') window.checkSessionInterval();
    else (event === 'focus' ? window : document).dispatchEvent(new Event(event));
  }, event);
  return nextList();
}
async function stableList() {
  assert.equal(await notice.count(), 0);
  assert.equal(await next.isEnabled(), true);
  assert.equal(await page.evaluate(() => window.savedTable === document.querySelector('.project-table')), true);
}
try {
  await page.goto(`${process.env.PROJECTS_REFRESH_URL || 'http://127.0.0.1:5173'}/organizations/1/projects`);
  const initial = await nextList();
  await notice.waitFor();
  await complete(initial);
  await notice.waitFor({ state: 'hidden' });
  // Let the existing 250 ms search debounce settle before testing pagination.
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.savedTable = document.querySelector('.project-table'); window.savedDocument = document; });
  for (const event of ['focus', 'visibilitychange', 'interval']) {
    const request = await observe(event);
    await stableList();
    await complete(request, `Updated by ${event}`);
    assert.equal(await page.evaluate(() => window.savedDocument === document), true);
  }
  console.log('PASS focus, visibility and periodic checks update the existing list silently');

  const stale = await observe('focus');
  await next.click();
  const secondPage = await nextList();
  assert.equal(new URL(secondPage.request().url()).searchParams.get('page'), '2');
  await notice.waitFor();
  assert.equal(await page.locator('.project-table').count(), 0);
  await complete(secondPage, 'Second page');
  await stale.fulfill({ json: { projects: [{ ...project, name: 'Stale response' }], total: 26, page: 1, has_more: true } });
  await page.waitForTimeout(100);
  assert.equal(await page.getByRole('link', { name: 'Stale response', exact: true }).count(), 0);
  assert.equal(await previous.isEnabled(), true);

  const failed = await observe('focus');
  assert.equal(new URL(failed.request().url()).searchParams.get('page'), '2');
  await failed.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'Temporary failure' } } });
  await page.getByRole('alert').filter({ hasText: 'Temporary failure' }).waitFor();
  await page.getByRole('link', { name: 'Second page', exact: true }).waitFor();
  assert.equal(await previous.isEnabled(), true);
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await complete(await nextList(), 'Recovered page');
  assert.equal(await page.getByRole('alert').count(), 0);
  console.log('PASS pagination supersedes stale responses; refresh failure preserves rows and supports retry');

  await page.getByRole('searchbox', { name: '搜索项目' }).fill('needle');
  const search = await nextList();
  assert.equal(new URL(search.request().url()).searchParams.get('search'), 'needle');
  assert.equal(new URL(search.request().url()).searchParams.get('page'), '1');
  await complete(search, 'Search result');
  await page.getByRole('tab', { name: '过去项目' }).click();
  const archived = await nextList();
  assert.equal(new URL(archived.request().url()).searchParams.get('status'), 'archived');
  await complete(archived, 'Archived result');
  const refresh = await observe('visibilitychange');
  const params = new URL(refresh.request().url()).searchParams;
  assert.equal(params.get('status'), 'archived');
  assert.equal(params.get('search'), 'needle');
  assert.equal(params.get('page'), '1');
  await stableListAfterFilter();
  await complete(refresh, 'Archived update');

  const denied = await observe('focus');
  await denied.fulfill({ status: 403, json: { error: { code: 'permission_denied', message: 'Access denied' } } });
  await page.getByRole('alert').filter({ hasText: 'Access denied' }).waitFor();
  assert.equal(await page.locator('.project-table').count(), 0);
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await complete(await nextList(), 'Access restored');
  organizations = [];
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText('指定组织不存在或无权访问，请选择可访问的组织。', { exact: true }).waitFor();
  assert.equal(await page.locator('.project-table').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS filters survive background checks; denied or removed organization clears the visible list');
} finally { await browser.close(); }

async function stableListAfterFilter() {
  assert.equal(await notice.count(), 0);
  assert.equal(await page.getByRole('searchbox', { name: '搜索项目' }).inputValue(), 'needle');
  assert.equal(await page.getByRole('link', { name: 'Archived result', exact: true }).count(), 1);
}
