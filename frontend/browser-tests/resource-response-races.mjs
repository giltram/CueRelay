// Actual App + controlled resource responses and synthetic media; no application DB.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { installI18nFixtures } from './i18n-fixtures.mjs';

const origin = process.env.RESOURCE_RACES_URL || 'http://127.0.0.1:5173';
const directory = mkdtempSync(join(tmpdir(), 'cuerelay-resource-races-'));
const video = join(directory, 'video.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=8',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video]);
const bytes = readFileSync(video);
const browser = await chromium.launch({ headless: true });
const only = process.argv[2];
const button = (page, name) => page.getByRole('button', { name, exact: true });
const denial = (code = 'permission_denied', status = 403) => ({ status, json: { error: { code, message: 'project access denied' } } });
const unauthorized = { status: 401, json: { error: { code: 'authentication_required', message: 'old authentication error' } } };

async function storedDrafts(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('cuerelay-workspace-drafts', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('drafts');
      const read = transaction.objectStore('drafts').getAll();
      read.onsuccess = () => resolve(read.result.map(record => ({ id: record.id, text: record.document.cues[0]?.text })));
      read.onerror = () => reject(read.error);
      transaction.oncomplete = () => db.close();
    };
  }));
}

async function fixture() {
  const context = await browser.newContext({ locale: 'zh-CN' });
  context.setDefaultTimeout(5000);
  await context.addInitScript(() => Object.defineProperty(document, 'visibilityState', { get: () => 'visible' }));
  const { state, errors } = await installI18nFixtures(context, bytes);
  const control = { holdDetails: false, details: [], lists: [] };
  await context.route('**/api/organizations/1/projects/7', route => {
    if (control.holdDetails) { control.details.push(route); return; }
    return route.fallback();
  });
  await context.route('**/api/organizations/1/projects?*', route => { control.lists.push(route); });
  const page = await context.newPage();
  const observe = () => page.evaluate(() => window.dispatchEvent(new Event('focus')));
  async function release(route, payload) {
    const received = page.waitForResponse(response => response.request() === route.request());
    await route.fulfill(payload);
    await (await received).finished();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  const list = (name, total = 50) => ({ json: { projects: name ? [{ ...state.project, name }] : [],
    total, page: 1, has_more: total > 25 } });
  async function workspace() {
    await page.goto(origin + '/organizations/1/projects/7/workspace');
    await page.getByLabel('导入本地视频', { exact: true }).setInputFiles(video);
    await button(page, '选择第 1 行').click();
    const text = page.getByLabel('字幕中文文本', { exact: true });
    await expect(text).toBeEnabled();
    await text.fill('保留的工作区草稿');
    return text;
  }
  return { context, page, state, errors, control, observe, release, list, workspace };
}

async function workspaceRevocation() {
  for (const [code, status, source] of [
    ['permission_denied', 403, 'poll'], ['not_found', 404, 'poll'],
    ['permission_denied', 403, 'reentry'], ['permission_denied', 403, 'reload'],
  ]) {
    const f = await fixture();
    try {
      const text = await f.workspace();
      const editor = await text.elementHandle();
      if (source === 'reload') await expect.poll(async () => (await storedDrafts(f.page))
        .some(draft => draft.text === '保留的工作区草稿')).toBe(true);
      f.control.holdDetails = true;
      if (source === 'reentry') {
        await f.page.getByRole('link', { name: 'CueRelay', exact: true }).click();
        await f.page.goBack();
      } else if (source === 'reload') {
        await button(f.page, '重新加载项目').click();
        await button(f.page, '明确放弃并继续').click();
      } else await f.observe();
      await expect.poll(() => f.control.details.length).toBe(1);
      await f.observe();
      await expect.poll(() => f.control.details.length).toBe(2);
      await f.release(f.control.details[1], denial(code, status));
      await expect(text).toBeDisabled();
      await f.release(f.control.details[0], { json: { project: f.state.project } });
      await expect(text).toBeDisabled();
      await expect(text).toHaveValue('保留的工作区草稿');
      assert(await editor.evaluate(node => node === document.querySelector('.subtitle-input textarea')));
      if (source === 'reload') assert((await storedDrafts(f.page)).some(draft => draft.text === '保留的工作区草稿'),
        'a rejected reload must not authorize deletion of the persisted draft');
      // A genuine newer successful observation can restore access.
      await f.observe();
      await expect.poll(() => f.control.details.length).toBe(3);
      await f.release(f.control.details[2], { json: { project: f.state.project } });
      await expect(text).toBeEnabled();
      await expect(text).toHaveValue('保留的工作区草稿');
      assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  }
  console.log('PASS workspace: stale poll/reentry/reload cannot clear 403/404 read-only or discard retained draft; newer confirmation restores editor');
}

async function workspaceAuthentication() {
  const f = await fixture();
  try {
    const text = await f.workspace();
    f.control.holdDetails = true;
    await f.observe();
    await expect.poll(() => f.control.details.length).toBe(1);
    await f.observe();
    await expect.poll(() => f.control.details.length).toBe(2);
    await f.release(f.control.details[0], unauthorized);
    await expect(f.page.getByRole('dialog')).toHaveCount(0);
    await expect(f.page.getByRole('alert')).toHaveCount(0);
    await expect(text).toBeEnabled();
    await f.release(f.control.details[1], { json: { project: f.state.project } });
    await expect(text).toHaveValue('保留的工作区草稿');
    assert.deepEqual(f.errors, []);
    console.log('PASS workspace authentication: superseded 401 stays silent while fresh project check is pending');
  } finally { await f.context.close(); }
  const initial = await fixture();
  try {
    initial.control.holdDetails = true;
    await initial.page.goto(origin + '/organizations/1/projects/7/workspace');
    await expect.poll(() => initial.control.details.length).toBe(1);
    // Wait for the newer identity confirmation before releasing the old read.
    await expect(initial.page.getByRole('link', { name: '设置', exact: true })).toBeVisible();
    const session = initial.page.waitForResponse(response => response.url().endsWith('/api/auth/session'));
    await initial.observe();
    await (await session).finished();
    await initial.release(initial.control.details[0], unauthorized);
    await expect.poll(() => initial.control.details.length).toBe(2);
    await initial.release(initial.control.details[1], { json: { project: initial.state.project } });
    await expect(button(initial.page, '选择第 1 行')).toBeVisible();
    await expect(initial.page.getByRole('dialog')).toHaveCount(0);
    await expect(initial.page.getByRole('alert')).toHaveCount(0);
    assert.deepEqual(initial.errors, []);
    console.log('PASS initial workspace: superseded entry read retries the current resource without a false account warning');
  } finally { await initial.context.close(); }
}

async function recoveredSupersededRoute() {
  for (const revoke of [false, true]) {
    const f = await fixture();
    try {
      const text = await f.workspace();
      const editor = await text.elementHandle();
      await expect.poll(async () => (await storedDrafts(f.page))
        .some(draft => draft.text === '保留的工作区草稿')).toBe(true);
      f.control.holdDetails = true;
      await f.page.getByRole('link', { name: 'CueRelay', exact: true }).click();
      await f.page.goBack();
      await expect.poll(() => f.control.details.length).toBe(1);
      const session = f.page.waitForResponse(response => response.url().endsWith('/api/auth/session'));
      await f.observe();
      await (await session).finished();
      await expect.poll(() => f.control.details.length).toBe(2);
      await f.release(f.control.details[1], { json: { project: f.state.project } });
      await expect(text).toBeEditable();
      if (revoke) {
        await f.observe();
        await expect.poll(() => f.control.details.length).toBe(3);
        await f.release(f.control.details[2], denial());
        await expect(text).toBeDisabled();
      }
      const reads = f.control.details.length;
      await f.release(f.control.details[0], unauthorized);
      await f.page.waitForTimeout(350);
      assert.equal(f.control.details.length, reads, 'a recovered route must not retry an obsolete entry read');
      await expect(text).toBeVisible();
      if (revoke) {
        await expect(text).toBeDisabled();
        await expect(f.page.getByRole('alert').filter({ hasText: 'project access denied' })).toBeVisible();
      } else {
        await expect(text).toBeEditable();
        await expect(f.page.getByRole('alert')).toHaveCount(0);
      }
      await expect(text).toHaveValue('保留的工作区草稿');
      await expect(f.page.getByRole('dialog')).toHaveCount(0);
      await expect(button(f.page, '重试加载')).toHaveCount(0);
      assert(await editor.evaluate(node => node === document.querySelector('.subtitle-input textarea')));
      assert((await storedDrafts(f.page)).some(draft => draft.text === '保留的工作区草稿'));
      assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  }
  console.log('PASS recovered cancellation: obsolete route 401 issues no extra read and preserves editor/draft plus current access, including newer denial');
}

async function unchangedSearch() {
  for (const query of ['', 'existing query']) {
    const f = await fixture();
    try {
      await f.page.goto(origin + '/organizations/1/projects');
      await expect.poll(() => f.control.lists.length).toBe(1);
      await f.release(f.control.lists[0], f.list('First page', 26));
      const search = f.page.getByRole('searchbox');
      if (query) {
        await search.fill(query);
        await expect.poll(() => f.control.lists.length).toBe(2);
        await f.release(f.control.lists[1], f.list('Filtered first page', 26));
      }
      await f.page.waitForTimeout(300);
      const offset = f.control.lists.length;
      await button(f.page, '下一页').click();
      await expect.poll(() => f.control.lists.length).toBe(offset + 1);
      await f.release(f.control.lists[offset], { json: { ...f.list('Second page', 26).json, page: 2, has_more: false } });
      await f.observe();
      await expect.poll(() => f.control.lists.length).toBe(offset + 2);
      await f.release(f.control.lists[offset + 1], { status: 503,
        json: { error: { code: 'unavailable', message: 'page two refresh failed' } } });
      const feedback = f.page.getByRole('alert').filter({ hasText: 'page two refresh failed' });
      await expect(feedback).toBeVisible();
      await search.fill(query + 'x');
      await search.fill(query);
      await f.page.waitForTimeout(400);
      assert.equal(f.control.lists.length, offset + 2, 'restoring the applied query during debounce must not request page one');
      await expect(f.page.getByRole('link', { name: 'Second page', exact: true })).toBeVisible();
      await expect(button(f.page, '上一页')).toBeEnabled();
      await expect(feedback).toBeVisible();
      await expect(button(f.page, '重试')).toBeVisible();
      // A genuinely changed query still owns page one and fresh feedback.
      await search.fill('changed query');
      await expect.poll(() => f.control.lists.length).toBe(offset + 3);
      const params = new URL(f.control.lists[offset + 2].request().url()).searchParams;
      assert.equal(params.get('page'), '1');
      assert.equal(params.get('search'), 'changed query');
      await expect(feedback).toHaveCount(0);
      await expect(button(f.page, '重试')).toHaveCount(0);
      await f.release(f.control.lists[offset + 2], f.list('New query page', 26));
      await expect(f.page.getByRole('link', { name: 'New query page', exact: true })).toBeVisible();
      assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  }
  console.log('PASS search debounce: restoring empty/nonempty applied query retains page two, feedback and request count; changed query resets page and feedback');
}

async function listCompletion() {
  const f = await fixture();
  try {
    await f.page.goto(origin + '/organizations/1/projects');
    await expect.poll(() => f.control.lists.length).toBe(1);
    // Organization reads keep failing, so they cannot trigger a replacement list.
    await f.context.route('**/api/organizations', route => route.fulfill({ status: 503,
      json: { error: { code: 'unavailable', message: 'organization offline' } } }));
    await f.observe();
    await expect(f.page.getByText('organization offline', { exact: false }).first()).toBeVisible();
    await f.release(f.control.lists[0], unauthorized);
    await expect.poll(() => f.control.lists.length).toBe(2);
    await f.release(f.control.lists[1], { status: 503,
      json: { error: { code: 'unavailable', message: 'list retry failed' } } });
    await expect(f.page.getByText('正在加载项目…', { exact: true })).toHaveCount(0);
    await expect(f.page.getByRole('alert').filter({ hasText: 'list retry failed' })).toBeVisible();
    await button(f.page, '重试').click();
    await expect.poll(() => f.control.lists.length).toBe(3);
    await f.release(f.control.lists[2], f.list('Recovered project'));
    await expect(f.page.getByRole('link', { name: 'Recovered project', exact: true })).toBeVisible();
    assert.deepEqual(f.errors, []);
    console.log('PASS completion: superseded initial list retries independently of failed organization reads, with direct retry after failure');
  } finally { await f.context.close(); }
}

async function paginationCorrection() {
  const f = await fixture();
  try {
    await f.page.goto(origin + '/organizations/1/projects');
    await expect.poll(() => f.control.lists.length).toBe(1);
    await f.release(f.control.lists[0], f.list('First page'));
    // Let the existing initial search debounce finish before navigating pages.
    await f.page.waitForTimeout(300);
    await button(f.page, '下一页').click();
    await expect.poll(() => f.control.lists.length).toBe(2);
    assert.equal(new URL(f.control.lists[1].request().url()).searchParams.get('page'), '2');
    await f.observe();
    await expect.poll(() => f.control.lists.length).toBe(3);
    await f.release(f.control.lists[1], f.list(null, 25));
    assert.equal(f.control.lists.length, 3, 'older total must not launch a page-one request');
    await f.release(f.control.lists[2], { json: { ...f.list('Current second page').json, page: 2, has_more: false } });
    await expect(f.page.getByRole('link', { name: 'Current second page', exact: true })).toBeVisible();
    await expect(button(f.page, '上一页')).toBeEnabled();
    // A fresh authoritative shrink must still correct a truly out-of-range page.
    await f.observe();
    await expect.poll(() => f.control.lists.length).toBe(4);
    await f.release(f.control.lists[3], f.list(null, 25));
    await expect.poll(() => f.control.lists.length).toBe(5);
    assert.equal(new URL(f.control.lists[4].request().url()).searchParams.get('page'), '1');
    await f.release(f.control.lists[4], f.list('Corrected first page', 25));
    await expect(f.page.getByRole('link', { name: 'Corrected first page', exact: true })).toBeVisible();
    await expect(button(f.page, '上一页')).toBeDisabled();
    assert.deepEqual(f.errors, []);
    console.log('PASS pagination: stale totals retain valid page two; latest confirmed shrink still corrects it');
  } finally { await f.context.close(); }
}

async function reloadConfirmation() {
  const f = await fixture();
  try {
    await f.workspace();
    await expect.poll(async () => (await storedDrafts(f.page)).some(draft => draft.text === '保留的工作区草稿')).toBe(true);
    const originalDraft = (await storedDrafts(f.page))[0].id;
    f.control.holdDetails = true;
    await button(f.page, '重新加载项目').click();
    await button(f.page, '明确放弃并继续').click();
    await expect.poll(() => f.control.details.length).toBe(1);
    await f.observe();
    await expect.poll(() => f.control.details.length).toBe(2);
    const fresh = structuredClone(f.state.project);
    fresh.revision++;
    fresh.document.cues[0].text = '远端新字幕';
    await f.release(f.control.details[1], { json: { project: fresh } });
    await f.release(f.control.details[0], { json: { project: fresh } });
    await expect(f.page.getByRole('dialog')).toHaveCount(0);
    await button(f.page, '选择第 1 行').click();
    await expect(f.page.getByLabel('字幕中文文本', { exact: true })).toHaveValue('远端新字幕');
    await expect.poll(async () => (await storedDrafts(f.page)).some(draft => draft.id === originalDraft)).toBe(false);
    await expect(f.page.getByRole('alert')).toHaveCount(0);
    assert.deepEqual(f.errors, []);
    console.log('PASS reload: a newer equal-revision status confirmation allows the explicitly authorized document replacement');
  } finally { await f.context.close(); }
}

async function reentryDenial() {
  const f = await fixture();
  try {
    const text = await f.workspace();
    const editor = await text.elementHandle();
    f.control.holdDetails = true;
    await f.page.getByRole('link', { name: 'CueRelay', exact: true }).click();
    await f.page.goBack();
    await expect.poll(() => f.control.details.length).toBe(1);
    await f.observe();
    await expect.poll(() => f.control.details.length).toBe(2);
    await f.release(f.control.details[1], { json: { project: f.state.project } });
    await f.release(f.control.details[0], denial());
    await expect(text).toBeVisible();
    await expect(text).toBeEditable();
    await expect(text).toHaveValue('保留的工作区草稿');
    await expect(f.page.getByRole('alert')).toHaveCount(0);
    assert(await editor.evaluate(node => node === document.querySelector('.subtitle-input textarea')));
    await f.observe();
    await expect.poll(() => f.control.details.length).toBe(3);
    await f.release(f.control.details[2], { json: { project: f.state.project } });
    await expect(text).toBeEditable();
    await f.page.getByRole('link', { name: 'CueRelay', exact: true }).click();
    await f.page.goBack();
    await expect.poll(() => f.control.details.length).toBe(4);
    await f.release(f.control.details[3], denial());
    await expect(text).toBeHidden();
    await f.observe();
    await expect.poll(() => f.control.details.length).toBe(5);
    await f.release(f.control.details[4], { json: { project: f.state.project } });
    await expect(text).toBeEditable();
    await expect(text).toBeVisible();
    await expect(text).toHaveValue('保留的工作区草稿');
    assert(await editor.evaluate(node => node === document.querySelector('.subtitle-input textarea')));
    await expect(f.page.getByRole('alert')).toHaveCount(0);
    assert.deepEqual(f.errors, []);
    console.log('PASS reentry: obsolete route denial preserves the confirmed editor/draft; a newer check also recovers a current route error');
  } finally { await f.context.close(); }
}

async function reentryRecoveryOrder() {
  for (const hiddenPoll of [false, true]) {
    const f = await fixture();
    try {
      const text = await f.workspace();
      const editor = await text.elementHandle();
      await expect.poll(async () => (await storedDrafts(f.page)).some(draft => draft.text === '保留的工作区草稿')).toBe(true);
      f.control.holdDetails = true;
      await f.page.getByRole('link', { name: 'CueRelay', exact: true }).click();
      if (hiddenPoll) {
        await f.observe();
        await expect.poll(() => f.control.details.length).toBe(1);
      }
      await f.page.goBack();
      await expect.poll(() => f.control.details.length).toBe(hiddenPoll ? 2 : 1);
      if (!hiddenPoll) {
        await f.observe();
        await expect.poll(() => f.control.details.length).toBe(2);
        await f.release(f.control.details[1], { status: 503,
          json: { error: { code: 'unavailable', message: 'newer poll failed' } } });
      }
      await f.release(f.control.details[hiddenPoll ? 1 : 0], { status: 503,
        json: { error: { code: 'unavailable', message: 'current route failed' } } });
      const routeError = f.page.getByRole('alert').filter({ hasText: 'current route failed' });
      await expect(routeError).toBeVisible();
      if (hiddenPoll) await f.release(f.control.details[0], { json: { project: f.state.project } });
      await expect(routeError).toBeVisible();
      await expect(text).toBeHidden();
      await expect(button(f.page, '重试加载')).toBeVisible();
      await expect(text).toHaveValue('保留的工作区草稿');
      assert((await storedDrafts(f.page)).some(draft => draft.text === '保留的工作区草稿'));
      // Both explicit route retry and a genuinely newer check can recover.
      if (hiddenPoll) await f.observe();
      else await button(f.page, '重试加载').click();
      await expect.poll(() => f.control.details.length).toBe(3);
      await f.release(f.control.details[2], { json: { project: f.state.project } });
      await expect(routeError).toHaveCount(0);
      await expect(f.page.getByRole('alert')).toHaveCount(0);
      await expect(text).toBeVisible();
      await expect(text).toBeEditable();
      await expect(text).toHaveValue('保留的工作区草稿');
      assert(await editor.evaluate(node => node === document.querySelector('.subtitle-input textarea')));
      assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  }
  console.log('PASS recovery order: failed reentry retains retry/draft; hidden older success cannot recover a newer route, fresh checks and retry can');
}

async function listFeedbackIsolation() {
  for (const change of ['status', 'search', 'page']) {
    const f = await fixture();
    try {
      await f.page.goto(origin + '/organizations/1/projects');
      await expect.poll(() => f.control.lists.length).toBe(1);
      await f.release(f.control.lists[0], f.list('Original project'));
      await f.page.waitForTimeout(300);
      await f.observe();
      await expect.poll(() => f.control.lists.length).toBe(2);
      await f.release(f.control.lists[1], { status: 503,
        json: { error: { code: 'unavailable', message: 'previous query failed' } } });
      const oldError = f.page.getByRole('alert').filter({ hasText: 'previous query failed' });
      await expect(oldError).toBeVisible();
      await button(f.page, '重试').click();
      await expect.poll(() => f.control.lists.length).toBe(3);
      await expect(oldError).toBeVisible();
      assert.equal(f.control.lists[2].request().url(), f.control.lists[1].request().url());
      if (change === 'status') await f.page.getByRole('tab', { name: '过去项目', exact: true }).click();
      else if (change === 'search') await f.page.getByRole('searchbox').fill('new query');
      else await button(f.page, '下一页').click();
      await expect.poll(() => f.control.lists.length).toBe(4);
      const params = new URL(f.control.lists[3].request().url()).searchParams;
      assert.equal(params.get(change === 'status' ? 'status' : change === 'search' ? 'search' : 'page'),
        change === 'status' ? 'archived' : change === 'search' ? 'new query' : '2');
      await expect(oldError).toHaveCount(0);
      await expect(button(f.page, '重试')).toHaveCount(0);
      // Even a still-pending retry from the old query must not restore feedback.
      await f.release(f.control.lists[2], { status: 503,
        json: { error: { code: 'unavailable', message: 'obsolete retry failed' } } });
      await expect(f.page.getByRole('alert')).toHaveCount(0);
      await f.release(f.control.lists[3], { json: { ...f.list('New query project').json, page: change === 'page' ? 2 : 1 } });
      await expect(f.page.getByRole('link', { name: 'New query project', exact: true })).toBeVisible();
      assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  }
  console.log('PASS list feedback isolation: status/search/manual page changes discard previous feedback and pending retries; same-query retry retains it');
}

async function recoveredRouteDenial() {
  const f = await fixture();
  try {
    const text = await f.workspace();
    const editor = await text.elementHandle();
    await expect.poll(async () => (await storedDrafts(f.page)).some(draft => draft.text === '保留的工作区草稿')).toBe(true);
    f.control.holdDetails = true;
    await f.page.getByRole('link', { name: 'CueRelay', exact: true }).click();
    await f.page.goBack();
    await expect.poll(() => f.control.details.length).toBe(1);
    await f.observe();
    await expect.poll(() => f.control.details.length).toBe(2);
    await f.release(f.control.details[1], { json: { project: f.state.project } });
    await expect(text).toBeEditable();
    await f.observe();
    await expect.poll(() => f.control.details.length).toBe(3);
    await f.release(f.control.details[2], denial());
    await expect(text).toBeDisabled();
    await f.release(f.control.details[0], { status: 404,
      json: { error: { code: 'not_found', message: 'obsolete route missing' } } });
    await expect(text).toBeVisible();
    await expect(text).toBeDisabled();
    await expect(text).toHaveValue('保留的工作区草稿');
    await expect(f.page.getByRole('alert').filter({ hasText: 'project access denied' })).toBeVisible();
    await expect(f.page.getByRole('alert').filter({ hasText: 'obsolete route missing' })).toHaveCount(0);
    await expect(button(f.page, '重试加载')).toHaveCount(0);
    assert(await editor.evaluate(node => node === document.querySelector('.subtitle-input textarea')));
    assert((await storedDrafts(f.page)).some(draft => draft.text === '保留的工作区草稿'));
    await f.observe();
    await expect.poll(() => f.control.details.length).toBe(4);
    await f.release(f.control.details[3], { json: { project: f.state.project } });
    await expect(text).toBeEditable();
    await expect(f.page.getByRole('alert')).toHaveCount(0);
    assert.deepEqual(f.errors, []);
    console.log('PASS recovered route: later denial retains the recovered read-only editor/draft; obsolete route 404 stays silent');
  } finally { await f.context.close(); }
}

async function retryRecoveryOrder() {
  const f = await fixture();
  try {
    const text = await f.workspace();
    const editor = await text.elementHandle();
    f.control.holdDetails = true;
    await f.page.getByRole('link', { name: 'CueRelay', exact: true }).click();
    await f.page.goBack();
    await expect.poll(() => f.control.details.length).toBe(1);
    await f.release(f.control.details[0], { status: 503,
      json: { error: { code: 'unavailable', message: 'first route failed' } } });
    await f.observe();
    await expect.poll(() => f.control.details.length).toBe(2);
    await button(f.page, '重试加载').click();
    await expect.poll(() => f.control.details.length).toBe(3);
    await f.release(f.control.details[1], { json: { project: f.state.project } });
    await expect(text).toBeHidden();
    await f.release(f.control.details[2], { status: 503,
      json: { error: { code: 'unavailable', message: 'second route failed' } } });
    await expect(f.page.getByRole('alert').filter({ hasText: 'second route failed' })).toBeVisible();
    await expect(text).toBeHidden();
    await f.observe();
    await expect.poll(() => f.control.details.length).toBe(4);
    await f.release(f.control.details[3], { json: { project: f.state.project } });
    await expect(text).toBeVisible();
    await expect(text).toBeEditable();
    await expect(text).toHaveValue('保留的工作区草稿');
    assert(await editor.evaluate(node => node === document.querySelector('.subtitle-input textarea')));
    await expect(f.page.getByRole('alert')).toHaveCount(0);
    assert.deepEqual(f.errors, []);
    console.log('PASS route retry: a new attempt requires its own eligible success; only a genuinely newer check recovers the retained draft');
  } finally { await f.context.close(); }
}

async function reselectStatus() {
  for (const tab of ['进行中项目', '过去项目']) {
    const f = await fixture();
    try {
      await f.page.goto(origin + '/organizations/1/projects');
      await expect.poll(() => f.control.lists.length).toBe(1);
      if (tab === '过去项目') {
        await f.page.getByRole('tab', { name: tab, exact: true }).click();
        await expect.poll(() => f.control.lists.length).toBe(2);
      }
      const offset = f.control.lists.length - 1;
      await f.release(f.control.lists[offset], f.list('First page', 26));
      await f.page.waitForTimeout(300);
      await button(f.page, '下一页').click();
      await expect.poll(() => f.control.lists.length).toBe(offset + 2);
      await f.release(f.control.lists[offset + 1], { json: { ...f.list('Second page', 26).json, page: 2 } });
      await f.observe();
      await expect.poll(() => f.control.lists.length).toBe(offset + 3);
      await f.release(f.control.lists[offset + 2], { status: 503,
        json: { error: { code: 'unavailable', message: 'page two failed' } } });
      await expect(f.page.getByRole('alert').filter({ hasText: 'page two failed' })).toBeVisible();
      await f.page.getByRole('tab', { selected: true }).click();
      await expect.poll(() => f.control.lists.length).toBe(offset + 4);
      const query = new URL(f.control.lists[offset + 3].request().url()).searchParams;
      assert.equal(query.get('page'), '1');
      assert.equal(query.get('status'), tab === '过去项目' ? 'archived' : 'active');
      await expect(f.page.getByRole('alert')).toHaveCount(0);
      await expect(button(f.page, '重试')).toHaveCount(0);
      await f.release(f.control.lists[offset + 3], f.list('Recovered first page', 26));
      await expect(f.page.getByRole('link', { name: 'Recovered first page', exact: true })).toBeVisible();
      assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  }
  console.log('PASS reselected status: either selected tab clears old page feedback when returning to page one');
}

async function projectFeedbackRecovery() {
  const f = await fixture();
  try {
    const text = await f.workspace();
    f.control.holdDetails = true;
    await f.context.route('**/api/organizations', route => route.fulfill({ status: 503,
      json: { error: { code: 'unavailable', message: 'organization still unavailable' } } }));
    await f.context.route('**/api/ass/export', route => route.fulfill({ status: 503,
      json: { error: { code: 'unavailable', message: 'user export failed' } } }));
    await f.page.getByRole('link', { name: 'CueRelay', exact: true }).click();
    await f.page.goBack();
    await expect.poll(() => f.control.details.length).toBe(1);
    await f.observe();
    await expect.poll(() => f.control.details.length).toBe(2);
    await f.release(f.control.details[1], { status: 503,
      json: { error: { code: 'unavailable', message: 'project poll failed' } } });
    await f.release(f.control.details[0], { status: 503,
      json: { error: { code: 'unavailable', message: 'project route failed' } } });
    await expect(f.page.getByRole('alert').filter({ hasText: 'project poll failed' })).toBeVisible();
    await button(f.page, '导出保留的工作区 ASS').click();
    await expect(f.page.getByRole('alert').filter({ hasText: 'ASS 转换失败（HTTP 503）' })).toBeVisible();
    await expect(f.page.getByRole('alert').filter({ hasText: 'project poll failed' })).toBeVisible();
    await button(f.page, '重试加载').click();
    await expect.poll(() => f.control.details.length).toBe(3);
    await f.release(f.control.details[2], { json: { project: f.state.project } });
    await expect(text).toBeEditable();
    await expect(f.page.getByRole('alert').filter({ hasText: 'project poll failed' })).toHaveCount(0);
    await expect(f.page.getByRole('alert').filter({ hasText: 'organization still unavailable' })).toBeVisible();
    await expect(f.page.getByRole('alert').filter({ hasText: 'ASS 转换失败（HTTP 503）' })).toBeVisible();
    await f.observe();
    await expect.poll(() => f.control.details.length).toBe(4);
    await f.release(f.control.details[3], { json: { project: f.state.project } });
    await expect(f.page.getByRole('alert').filter({ hasText: 'project poll failed' })).toHaveCount(0);
    await expect(f.page.getByRole('alert').filter({ hasText: 'ASS 转换失败（HTTP 503）' })).toBeVisible();
    await expect(f.page.getByRole('alert').filter({ hasText: 'organization still unavailable' })).toBeVisible();
    await expect(text).toHaveValue('保留的工作区草稿');
    assert.deepEqual(f.errors, []);
    console.log('PASS project feedback: recovered project reads clear only project checks, retaining organization and user export failures');
  } finally { await f.context.close(); }
}

async function archiveConfirmation() {
  for (const action of ['save', 'split']) {
    const f = await fixture();
    try {
      if (action === 'split') await f.context.route('**/api/me/settings', route => route.fulfill({ json: {
        language_preference: 'zh-CN', handbook_seen: true, shortcut_overrides: { 'split-text': ['Ctrl+KeyT'] },
        audio_display_mode: 'spectrum', mouse_sets_cue_boundary: true,
      } }));
      const text = await f.workspace();
      f.control.holdDetails = true;
      await f.observe();
      await expect.poll(() => f.control.details.length).toBe(1);
      await f.context.route(`**/api/organizations/1/projects/7/${action === 'save' ? 'document' : 'split'}`,
        route => route.fulfill({ status: 409, json: { error: { code: 'project_archived', message: 'confirmed archive' } } }));
      if (action === 'save') await button(f.page, '保存项目').click();
      else {
        await text.focus();
        await text.evaluate(node => node.setSelectionRange(1, 1));
        await text.press('Control+t');
      }
      await expect(text).not.toBeEditable();
      await expect(button(f.page, '保存项目')).toHaveCount(0);
      await f.release(f.control.details[0], { json: { project: f.state.project } });
      await expect(text).not.toBeEditable();
      await expect(button(f.page, '保存项目')).toHaveCount(0);
      await expect(text).toHaveValue('保留的工作区草稿');
      await f.observe();
      await expect.poll(() => f.control.details.length).toBe(2);
      await f.release(f.control.details[1], { json: { project: f.state.project } });
      await expect(text).toBeEditable();
      await expect(button(f.page, '保存项目')).toBeEnabled();
      assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  }
  console.log('PASS archive: save and split establish read-only ordering barriers, while genuinely newer restoration still works');
}

async function settledPagination() {
  // Cover both orders: older valid total arrives before or after newer 503.
  for (const successFirst of [false, true]) {
    const f = await fixture();
    try {
      await f.page.goto(origin + '/organizations/1/projects');
      await expect.poll(() => f.control.lists.length).toBe(1);
      await f.release(f.control.lists[0], f.list('First project', 26));
      await f.page.waitForTimeout(300);
      await button(f.page, '下一页').click();
      await expect.poll(() => f.control.lists.length).toBe(2);
      await f.release(f.control.lists[1], { json: { ...f.list('Removed project', 26).json, page: 2, has_more: false } });
      await f.observe();
      await expect.poll(() => f.control.lists.length).toBe(3);
      await f.observe();
      await expect.poll(() => f.control.lists.length).toBe(4);
      const shrink = () => f.release(f.control.lists[2], { json: { projects: [], total: 25, page: 2, has_more: false } });
      const failure = () => f.release(f.control.lists[3], { status: 503,
        json: { error: { code: 'unavailable', message: 'latest list read failed' } } });
      if (successFirst) {
        await shrink();
        assert.equal(f.control.lists.length, 4, 'do not correct while the newer read is pending');
        await failure();
      } else { await failure(); await shrink(); }
      await expect.poll(() => f.control.lists.length).toBe(5);
      assert.equal(new URL(f.control.lists[4].request().url()).searchParams.get('page'), '1');
      await expect(f.page.getByRole('link', { name: 'Removed project', exact: true })).toHaveCount(0);
      await expect(f.page.getByRole('alert').filter({ hasText: 'latest list read failed' })).toBeVisible();
      await f.release(f.control.lists[4], f.list('Corrected project', 25));
      await expect(f.page.getByRole('link', { name: 'Corrected project', exact: true })).toBeVisible();
      await expect(button(f.page, '上一页')).toBeDisabled();
      await expect(f.page.getByRole('alert')).toHaveCount(0);
      assert.deepEqual(f.errors, []);
    } finally { await f.context.close(); }
  }
  console.log('PASS settled pagination: final valid totals correct stale page two after either 503 order, preserving newer feedback until recovery');
}

try {
  for (const [name, run] of Object.entries({ workspace: workspaceRevocation, authentication: workspaceAuthentication,
    cancellation: recoveredSupersededRoute, search: unchangedSearch, completion: listCompletion, pagination: paginationCorrection, reload: reloadConfirmation,
    reentry: reentryDenial, recovery: reentryRecoveryOrder, isolation: listFeedbackIsolation, denial: recoveredRouteDenial, attempt: retryRecoveryOrder, reselect: reselectStatus, feedback: projectFeedbackRecovery, archive: archiveConfirmation, settled: settledPagination })) if (!only || only === name) await run();
} finally { await browser.close(); rmSync(directory, { recursive: true, force: true }); }
