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

async function fixture() {
  const context = await browser.newContext({ locale: 'zh-CN' });
  context.setDefaultTimeout(5000);
  await context.addInitScript(() => Object.defineProperty(document, 'visibilityState', { get: () => 'visible' }));
  const { state, errors } = await installI18nFixtures(context, bytes);
  const control = { holdDetails: false, holdOrganizations: false, details: [], organizations: [], lists: [] };
  await context.route('**/api/organizations/1/projects/7', route => {
    if (control.holdDetails) { control.details.push(route); return; }
    return route.fallback();
  });
  await context.route('**/api/organizations', route => {
    if (control.holdOrganizations) { control.organizations.push(route); return; }
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

async function listCompletion() {
  const f = await fixture();
  try {
    await f.page.goto(origin + '/organizations/1/projects');
    await expect.poll(() => f.control.lists.length).toBe(1);
    f.control.holdOrganizations = true;
    await f.observe();
    await expect.poll(() => f.control.organizations.length).toBe(1);
    // Session succeeds, but no organization response has requested another list.
    await f.release(f.control.lists[0], unauthorized);
    assert.equal(f.control.lists.length, 1);
    await expect(f.page.getByText('正在加载项目…', { exact: true })).toHaveCount(0);
    await expect(f.page.getByRole('alert')).toHaveCount(0);
    await f.release(f.control.organizations[0], { json: { organizations: [f.state.org] } });
    await expect.poll(() => f.control.lists.length).toBe(2);
    await f.release(f.control.lists[1], f.list('Recovered project'));
    await expect(f.page.getByRole('link', { name: 'Recovered project', exact: true })).toBeVisible();
    assert.deepEqual(f.errors, []);
    console.log('PASS completion: the sole superseded request settles loading; a later refresh still recovers');
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

try {
  for (const [name, run] of Object.entries({ workspace: workspaceRevocation, authentication: workspaceAuthentication,
    completion: listCompletion, pagination: paginationCorrection })) if (!only || only === name) await run();
} finally { await browser.close(); rmSync(directory, { recursive: true, force: true }); }
