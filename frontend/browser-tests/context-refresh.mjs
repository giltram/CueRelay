// Real App, deferred HTTP and IndexedDB; no application database writes.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { installI18nFixtures } from './i18n-fixtures.mjs';

const origin = process.env.CONTEXT_REFRESH_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const only = process.argv[2];
const button = (page, name) => page.getByRole('button', { name, exact: true });
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const failure = message => ({ status: 503, json: { error: { code: 'unavailable', message } } });
const settings = { language_preference: 'zh-CN', handbook_seen: true, shortcut_overrides: {},
  audio_display_mode: 'spectrum', mouse_sets_cue_boundary: true };

async function fixture() {
  const context = await browser.newContext({ locale: 'zh-CN' });
  context.setDefaultTimeout(5000);
  await context.addInitScript(() => {
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
    const interval = window.setInterval;
    window.setInterval = (callback, delay, ...args) => {
      if (delay === 30000) window.checkSessionInterval = () => callback(...args);
      return interval(callback, delay, ...args);
    };
  });
  const { state, errors } = await installI18nFixtures(context, Buffer.from('unused-media'));
  const control = { holdOrganizations: false, holdSettings: false, organizations: [state.org],
    organizationRequests: [], settingsRequests: [] };
  await context.route('**/api/organizations', route => {
    if (control.holdOrganizations) { control.organizationRequests.push(route); return; }
    return route.fulfill({ json: { organizations: control.organizations } });
  });
  await context.route('**/api/me/settings', route => {
    if (control.holdSettings) { control.settingsRequests.push(route); return; }
    return route.fulfill({ json: settings });
  });
  const page = await context.newPage();
  async function observe(event = 'focus') {
    await page.evaluate(event => {
      if (event === 'interval') window.checkSessionInterval();
      else (event === 'focus' ? window : document).dispatchEvent(new Event(event));
    }, event);
  }
  async function release(route, response) {
    const received = page.waitForResponse(response => response.request() === route.request());
    await route.fulfill(response);
    await (await received).finished(); await settle(page);
  }
  return { context, page, control, state, errors, observe, release };
}

async function localScope() {
  const f = await fixture();
  try {
    f.control.holdOrganizations = true;
    await f.page.goto(origin + '/organizations/1/projects');
    await expect.poll(() => f.control.organizationRequests.length).toBe(1);
    const link = f.page.getByRole('link', { name: '本地工作区', exact: true });
    await expect(link).toHaveAttribute('href', '/organizations/1/workspace/local');
    const opened = f.page.waitForEvent('popup');
    await link.click();
    const local = await opened;
    const text = local.getByRole('textbox', { name: '字幕中文文本', exact: true });
    await text.fill('组织响应之前的本地草稿');
    await expect(local.getByText('本地草稿已保存。', { exact: true })).toBeVisible();
    const scopes = await local.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('cuerelay-workspace-drafts', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction('drafts');
        const read = transaction.objectStore('drafts').getAll();
        read.onsuccess = () => resolve(read.result.map(record => record.scope));
        transaction.oncomplete = () => db.close();
      };
    }));
    assert.deepEqual(scopes, [JSON.stringify([1, 1, null])]);
    f.control.holdOrganizations = false;
    await local.reload();
    await button(local, '恢复草稿').click();
    await expect(text).toHaveValue('组织响应之前的本地草稿');
    assert.deepEqual(f.errors, []);
    console.log('PASS local: early local workspace uses route organization and restores the scoped draft');
  } finally { await f.context.close(); }
}

async function homeScope() {
  const f = await fixture();
  try {
    f.control.holdOrganizations = true;
    await f.page.goto(origin + '/');
    await expect.poll(() => f.control.organizationRequests.length).toBe(1);
    await expect(f.page.getByRole('link', { name: '本地工作区', exact: true })).toHaveCount(0);
    await expect(button(f.page, '本地工作区')).toBeDisabled();
    await f.release(f.control.organizationRequests[0], failure('home organization load failed'));
    await expect(button(f.page, '本地工作区')).toBeDisabled();
    await button(f.page, '刷新会话与设置').click();
    await expect.poll(() => f.control.organizationRequests.length).toBe(2);
    f.control.holdOrganizations = false;
    await f.release(f.control.organizationRequests[1], { json: { organizations: [f.state.org] } });
    const link = f.page.getByRole('link', { name: '本地工作区', exact: true });
    await expect(link).toHaveAttribute('href', '/organizations/1/workspace/local');
    const opened = f.page.waitForEvent('popup');
    await link.click();
    const local = await opened;
    await local.getByLabel('字幕中文文本', { exact: true }).fill('首页入口的本地草稿');
    await expect(local.getByText('本地草稿已保存。', { exact: true })).toBeVisible();
    await local.close();
    await f.page.reload();
    const reopened = f.page.waitForEvent('popup');
    await link.click();
    const recovered = await reopened;
    await button(recovered, '恢复草稿').click();
    await expect(recovered.getByLabel('字幕中文文本', { exact: true })).toHaveValue('首页入口的本地草稿');
    // An explicit empty membership result resolves the unscoped local entry.
    f.control.organizations = [];
    await f.page.reload();
    await expect(link).toHaveAttribute('href', '/workspace/local');
    assert.deepEqual(f.errors, []);
    console.log('PASS home: unresolved organization cannot open a different draft scope; same entry restores draft');
  } finally { await f.context.close(); }
}

async function revocationAfterFailure() {
  const f = await fixture();
  try {
    await f.page.goto(origin + '/organizations/1/projects');
    await expect(f.page.locator('.project-table')).toBeVisible();
    f.control.holdOrganizations = true;
    await f.observe();
    await expect.poll(() => f.control.organizationRequests.length).toBe(1);
    await f.observe('visibilitychange');
    await expect.poll(() => f.control.organizationRequests.length).toBe(2);
    await f.release(f.control.organizationRequests[1], failure('newer organization 503'));
    await f.release(f.control.organizationRequests[0], { json: { organizations: [] } });
    await expect(f.page.locator('.project-table')).toHaveCount(0);
    await expect(f.page.getByRole('option', { name: /组织 Organization/ })).toHaveCount(0);
    await expect(f.page.getByRole('alert').filter({ hasText: 'newer organization 503' })).toBeVisible();
    assert.deepEqual(f.errors, []);
    console.log('PASS revocation: newer 503 does not discard an older successful revocation or erase its error');
  } finally { await f.context.close(); }
}

async function slowProjectList() {
  const f = await fixture();
  try {
    const pending = [];
    await f.context.route('**/api/organizations/1/projects?*', route => { pending.push(route); });
    const list = name => ({ json: { projects: [{ ...f.state.project, name }], total: 1, page: 1, has_more: false } });
    await f.page.goto(origin + '/organizations/1/projects');
    await expect.poll(() => pending.length).toBe(1);
    await f.observe();
    await expect.poll(() => pending.length).toBe(2);
    await f.release(pending[0], list('First completed project'));
    await expect(f.page.getByRole('link', { name: 'First completed project', exact: true })).toBeVisible();
    await f.observe('visibilitychange');
    await expect.poll(() => pending.length).toBe(3);
    await f.release(pending[1], list('Second completed project'));
    await expect(f.page.getByRole('link', { name: 'Second completed project', exact: true })).toBeVisible();
    await f.observe('interval');
    await expect.poll(() => pending.length).toBe(4);
    await f.release(pending[3], failure('newer project 503'));
    await f.release(pending[2], { status: 403, json: { error: { code: 'permission_denied', message: 'project revoked' } } });
    await expect(f.page.locator('.project-table')).toHaveCount(0);
    await expect(f.page.getByRole('alert')).toContainText('newer project 503');
    assert.deepEqual(f.errors, []);
    console.log('PASS projects: overlapping reads advance the initial list; 503 cannot suppress confirmed denial');
  } finally { await f.context.close(); }
}

function records(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('cuerelay-workspace-drafts', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('drafts');
      const read = transaction.objectStore('drafts').getAll();
      read.onsuccess = () => resolve(read.result);
      transaction.oncomplete = () => db.close();
    };
  }));
}

async function accountSwitch() {
  const f = await fixture();
  try {
    await f.page.goto(origin + '/workspace/local');
    await f.page.getByLabel('字幕中文文本', { exact: true }).fill('已明确放弃的旧账号草稿');
    await expect(f.page.getByText('本地草稿已保存。', { exact: true })).toBeVisible();
    assert.equal((await records(f.page)).length, 1);
    f.control.holdSettings = true;
    f.state.user = { ...f.state.user, id: 2, username: 'language-user-two' };
    await f.observe();
    await expect(f.page.getByRole('dialog')).toBeVisible();
    await button(f.page, '明确放弃并继续').click();
    await expect.poll(() => f.control.settingsRequests.length).toBe(1);
    await expect.poll(() => records(f.page)).toHaveLength(0);
    await expect(f.page.getByRole('dialog')).toHaveCount(0);
    await expect(f.page.getByRole('combobox', { name: '当前组织', exact: true })).toBeEnabled();
    await f.release(f.control.settingsRequests[0], failure('new account settings failed'));
    await expect.poll(() => records(f.page)).toHaveLength(0);
    assert.deepEqual(f.errors, []);
    console.log('PASS account: confirmed switch discards the old draft before new settings return or fail');
  } finally { await f.context.close(); }
}

async function staleAuthentication() {
  const f = await fixture();
  try {
    await f.page.goto(origin + '/organizations/1/projects');
    await expect(f.page.locator('.project-table')).toBeVisible();
    f.control.holdOrganizations = true;
    await f.observe();
    await expect.poll(() => f.control.organizationRequests.length).toBe(1);
    await f.observe('visibilitychange');
    await expect.poll(() => f.control.organizationRequests.length).toBe(2);
    const unauthorized = { status: 401, json: { error: { code: 'authentication_required', message: 'old expired session' } } };
    await f.release(f.control.organizationRequests[0], unauthorized);
    await expect(f.page.getByRole('dialog')).toHaveCount(0);
    await expect(f.page.getByRole('alert')).toHaveCount(0);
    await expect(f.page.getByRole('combobox', { name: '当前组织', exact: true })).toBeEnabled();
    await f.release(f.control.organizationRequests[1], { json: { organizations: [f.state.org] } });
    // A current denial still expires the session; it is not globally ignored.
    await f.observe();
    await expect.poll(() => f.control.organizationRequests.length).toBe(3);
    await f.release(f.control.organizationRequests[2], unauthorized);
    await expect(f.page.getByRole('dialog')).toBeVisible();
    assert.deepEqual(f.errors, []);
    console.log('PASS authentication: stale 401 cannot reopen login after confirmation; current 401 still does');
  } finally { await f.context.close(); }
}

async function overlappingOrganizations() {
  const f = await fixture();
  try {
    f.control.holdOrganizations = true;
    await f.page.goto(origin + '/organizations/1/projects');
    await expect.poll(() => f.control.organizationRequests.length).toBe(1);
    await f.observe('visibilitychange');
    await expect.poll(() => f.control.organizationRequests.length).toBe(2);
    await f.release(f.control.organizationRequests[0], { json: { organizations: [f.state.org] } });
    await expect(f.page.getByRole('link', { name: f.state.project.name, exact: true })).toBeVisible();
    // Keep a newer observation in flight for each completed response.
    for (const [index, event] of ['interval', 'focus'].entries()) {
      await f.observe(event);
      await expect.poll(() => f.control.organizationRequests.length).toBe(index + 3);
      await f.release(f.control.organizationRequests[index + 1], { json: {
        organizations: [{ ...f.state.org, name: `Completed organization ${index}` }],
      } });
      await expect(f.page.getByRole('option', { name: new RegExp(`Completed organization ${index}`) })).toBeAttached();
    }
    // A later completed revocation still supersedes an older pending response.
    await f.observe();
    await expect.poll(() => f.control.organizationRequests.length).toBe(5);
    await f.release(f.control.organizationRequests[4], { json: { organizations: [] } });
    await f.release(f.control.organizationRequests[3], { json: { organizations: [f.state.org] } });
    await expect(f.page.locator('.project-table')).toHaveCount(0);
    await expect(f.page.getByRole('option', { name: /组织 Organization/ })).toHaveCount(0);
    assert.deepEqual(f.errors, []);
    console.log('PASS overlapping: slow completed responses make progress; stale response cannot restore revoked access');
  } finally { await f.context.close(); }
}

async function leaveWithSlowSettings() {
  const f = await fixture();
  try {
    await f.page.goto(origin + '/organizations/1/settings/organization');
    await expect(button(f.page, '退出此组织')).toBeEnabled();
    const next = { ...f.state.org, id: 2, name: 'Remaining organization' };
    f.control.organizations = [next]; f.control.holdSettings = true;
    await f.context.route('**/api/organizations/1/leave', route => route.fulfill({ json: {} }));
    await f.context.route('**/api/organizations/2/projects*', route => route.fulfill({ json: {
      projects: [{ ...f.state.project, organization_id: 2 }], total: 1, page: 1, has_more: false,
    } }));
    await button(f.page, '退出此组织').click();
    await button(f.page, '明确放弃并继续').click();
    await expect.poll(() => f.control.settingsRequests.length).toBe(1);
    await expect(f.page).toHaveURL(origin + '/organizations/2/projects');
    await expect(f.page.getByRole('combobox', { name: '当前组织', exact: true })).toBeEnabled();
    await expect(f.page.getByRole('link', { name: f.state.project.name, exact: true })).toBeVisible();
    await expect(button(f.page, '新建项目')).toBeEnabled();
    await f.release(f.control.settingsRequests[0], failure('delayed settings failure'));
    await expect(f.page.getByRole('alert')).toContainText('delayed settings failure');
    await expect(button(f.page, '新建项目')).toBeEnabled();
    assert.deepEqual(f.errors, []);
    console.log('PASS leave: refreshed projects and controls work before personal settings finish');
  } finally { await f.context.close(); }
}

async function retryErrors() {
  const f = await fixture();
  try {
    f.control.holdOrganizations = true; f.control.holdSettings = true;
    await f.page.goto(origin + '/organizations/1/projects');
    await expect.poll(() => f.control.organizationRequests.length).toBe(1);
    await expect.poll(() => f.control.settingsRequests.length).toBe(1);
    await f.release(f.control.organizationRequests[0], failure('organization refresh failed'));
    await f.release(f.control.settingsRequests[0], failure('settings refresh failed'));
    await button(f.page, '刷新会话与设置').click();
    await expect.poll(() => f.control.organizationRequests.length).toBe(2);
    await expect.poll(() => f.control.settingsRequests.length).toBe(2);
    await f.release(f.control.organizationRequests[1], { json: { organizations: [f.state.org] } });
    await expect(f.page.getByRole('alert')).toContainText('settings refresh failed');
    await expect(f.page.getByRole('alert')).not.toContainText('organization refresh failed');
    await f.release(f.control.settingsRequests[1], { json: settings });
    await expect(f.page.getByRole('alert')).toHaveCount(0);
    // A late failure from before a newer successful refresh must stay silent.
    await f.observe();
    await expect.poll(() => f.control.organizationRequests.length).toBe(3);
    await f.observe('visibilitychange');
    await expect.poll(() => f.control.organizationRequests.length).toBe(4);
    await f.release(f.control.organizationRequests[3], { json: { organizations: [f.state.org] } });
    await f.release(f.control.settingsRequests[3], { json: settings });
    await f.release(f.control.organizationRequests[2], failure('stale organization error'));
    await f.release(f.control.settingsRequests[2], failure('stale settings error'));
    await expect(f.page.getByRole('alert')).toHaveCount(0);
    f.control.holdOrganizations = false; f.control.holdSettings = false;
    await f.context.route('**/api/auth/session', route => route.fulfill(failure('session refresh failed')), { times: 1 });
    await f.observe();
    await expect(f.page.getByRole('alert')).toContainText('session refresh failed');
    await button(f.page, '刷新会话与设置').click();
    await expect(f.page.getByRole('alert')).toHaveCount(0);
    assert.deepEqual(f.errors, []);
    console.log('PASS retry: success clears only its resource error; stale failures stay silent');
  } finally { await f.context.close(); }
}

try {
  for (const [name, run] of Object.entries({ local: localScope, overlapping: overlappingOrganizations,
    leave: leaveWithSlowSettings, retry: retryErrors, home: homeScope, revocation: revocationAfterFailure,
    projects: slowProjectList, account: accountSwitch, authentication: staleAuthentication })) {
    if (!only || only === name) await run();
  }
} finally { await browser.close(); }
