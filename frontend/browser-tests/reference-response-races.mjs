// Actual App with committed-but-delayed HTTP snapshots; no application database.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { installI18nFixtures } from './i18n-fixtures.mjs';
import { unavailableAssPreview } from './ass-preview-fixture.mjs';

const origin = process.env.REFERENCE_RACES_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true });
const only = process.argv[2];
const cue = text => ({ start_ms: 0, end_ms: 2000, text });
const button = (page, name) => page.getByRole('button', { name, exact: true });

async function fixture() {
  const context = await browser.newContext({ locale: 'zh-CN' });
  context.setDefaultTimeout(5000);
  const { state, errors } = await installI18nFixtures(context, Buffer.from('unused-media'));
  state.project.reference = { version: 1, cues: [cue('reference v1')] };
  const holds = new Map();
  const writes = [];
  await context.route('**/api/**', async route => {
    if (await unavailableAssPreview(route)) return;
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    let snapshot;
    if (path === `/api/organizations/1/projects/${state.project.id}` && method === 'GET') {
      snapshot = { project: structuredClone(state.project) };
    } else if (path === `/api/organizations/1/projects/${state.project.id}/reference` && method === 'PUT') {
      const data = route.request().postDataJSON();
      writes.push(data);
      if (data.version !== state.project.reference.version) return route.fulfill({ status: 409,
        json: { error: { code: 'reference_conflict', message: '参考字幕已变化' } } });
      // Commit before capturing the response; another writer may commit again.
      state.project.reference = { version: data.version + 1,
        cues: data.source === null ? null : [cue('upload v2'), cue('second')] };
      snapshot = { reference: structuredClone(state.project.reference) };
    } else return route.fallback();
    const capture = holds.get(method);
    if (capture) { holds.delete(method); capture({ route, snapshot }); return; }
    return route.fulfill({ json: snapshot });
  });
  const page = await context.newPage();
  const holdNext = method => {
    assert(!holds.has(method));
    const captured = Promise.withResolvers();
    holds.set(method, captured.resolve);
    return captured.promise;
  };
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function release({ route, snapshot }) {
    const received = page.waitForResponse(response => response.request() === route.request());
    await route.fulfill({ json: snapshot });
    await (await received).finished();
    await settle();
  }
  async function observe() {
    const received = page.waitForResponse(response => response.url().endsWith('/projects/7'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await (await received).finished();
    await settle();
  }
  return { context, page, state, errors, writes, holdNext, release, observe };
}

async function reloadReference(clear) {
  const f = await fixture();
  try {
    await f.page.goto(origin + '/organizations/1/projects/7/workspace');
    await expect(f.page.getByText('reference v1', { exact: true })).toBeVisible();
    const held = f.holdNext('GET');
    await button(f.page, '重新加载项目').click();
    const oldReload = await held;
    f.state.project.reference = { version: 2, cues: clear ? null : [cue('newest reference v2')] };
    f.state.project.effective_permissions = { edit_subtitles: false };
    // Even an observation carrying different body text must never adopt it.
    f.state.project.document.cues[0].text = 'observation body must stay remote';
    await f.observe();
    await expect(button(f.page, '保存项目')).toHaveCount(0);
    if (clear) await expect(f.page.locator('.reference-content')).toHaveCount(0);
    else await expect(f.page.getByText('newest reference v2', { exact: true })).toBeVisible();
    await button(f.page, '选择第 1 行').click();
    await expect(f.page.getByLabel('字幕中文文本', { exact: true })).toHaveValue('用户内容 User content');
    await f.release(oldReload);
    await expect(button(f.page, '保存项目')).toHaveCount(0);
    await button(f.page, '选择第 1 行').click();
    await expect(f.page.getByLabel('字幕中文文本', { exact: true })).toHaveValue('用户内容 User content');
    await expect(f.page.getByText('reference v1', { exact: true })).toHaveCount(0);
    if (clear) await expect(f.page.locator('.reference-content')).toHaveCount(0);
    else await expect(f.page.getByText('newest reference v2', { exact: true })).toBeVisible();
    assert.deepEqual(f.errors, []);
    console.log(`PASS reload ${clear ? 'clear' : 'replace'}: same body revision/status retains newer reference and explicit-only body adoption`);
  } finally { await f.context.close(); }
}

async function reloadRevision() {
  const f = await fixture();
  try {
    await f.page.goto(origin + '/organizations/1/projects/7/workspace');
    await button(f.page, '选择第 1 行').click();
    const text = f.page.getByLabel('字幕中文文本', { exact: true });
    const editor = await text.elementHandle();
    const held = f.holdNext('GET');
    await button(f.page, '重新加载项目').click();
    const oldReload = await held;
    f.state.project.revision++;
    f.state.project.document.cues[0].text = 'new revision body';
    f.state.project.reference = { version: 2, cues: [cue('newest reference v2')] };
    await f.observe();
    await f.release(oldReload);
    await expect(text).toHaveValue('用户内容 User content');
    assert(await editor.evaluate(node => node.isConnected), 'newer body revision must block the old reload');
    await expect(f.page.getByText('newest reference v2', { exact: true })).toBeVisible();
    await button(f.page, '重新加载项目').click();
    await button(f.page, '选择第 1 行').click();
    await expect(text).toHaveValue('new revision body');
    assert.deepEqual(f.errors, []);
    console.log('PASS reload revision: newer observation blocks old body reload; fresh explicit reload alone adopts the new body');
  } finally { await f.context.close(); }
}

async function selectFile(page, name = 'probe.srt') {
  await page.getByLabel('选择参考 SRT', { exact: true }).setInputFiles({ name, mimeType: 'text/plain',
    buffer: Buffer.from('1\n00:00:00,000 --> 00:00:02,000\nupload v2') });
  await expect(button(page, '上传参考字幕')).toBeEnabled();
}

async function settingsReference(clear) {
  const f = await fixture();
  try {
    await f.page.goto(origin + '/organizations/1/projects/7/settings');
    await selectFile(f.page);
    const held = f.holdNext('PUT');
    await button(f.page, '上传参考字幕').click();
    const oldPut = await held;
    f.state.project.reference = { version: 3, cues: clear ? null : [cue('latest A'), cue('latest B'), cue('latest C')] };
    await button(f.page, '刷新项目版本').click();
    const section = f.page.getByRole('region', { name: '参考字幕', exact: true });
    const authoritativeText = clear ? '尚无参考字幕。' : '已保存 3 段参考字幕。';
    await expect(section).toContainText(authoritativeText);
    await f.release(oldPut);
    await expect(section.getByRole('status')).toBeVisible();
    await expect(button(f.page, '上传参考字幕')).toHaveCount(0);
    await expect(section).toContainText(authoritativeText);
    if (clear) {
      await expect(button(f.page, '清除参考字幕')).toHaveCount(0);
      await selectFile(f.page);
      await button(f.page, '上传参考字幕').click();
    } else await button(f.page, '清除参考字幕').click();
    await expect.poll(() => f.writes.length).toBe(2);
    assert.equal(f.writes[1].version, 3, 'next CAS must use the latest GET version');
    await expect(section.getByRole('alert')).toHaveCount(0);
    await expect(f.page.getByLabel('选择参考 SRT', { exact: true })).toBeEnabled();
    assert.equal(f.state.project.reference.version, 4);
    assert.deepEqual(f.errors, []);
    console.log(`PASS settings ${clear ? 'clear' : 'replace'}: delayed PUT completes feedback/candidate cleanup without lowering GET v3; next write uses v3`);
  } finally { await f.context.close(); }
}

async function settingsLifetime() {
  for (const mode of ['disabled', 'project']) {
    const f = await fixture();
    try {
      await f.page.goto(origin + '/organizations/1/projects/7/settings');
      await selectFile(f.page);
      const held = f.holdNext('PUT');
      await button(f.page, '上传参考字幕').click();
      const oldPut = await held;
      if (mode === 'disabled') {
        f.state.anonymous = true;
        await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await expect(button(f.page, '重新登录')).toBeVisible();
        await expect(f.page.getByLabel('选择参考 SRT', { exact: true })).toBeDisabled();
      } else {
        // A different project starts at its own lower reference version.
        f.state.project = { ...f.state.project, id: 8, reference: { version: 1, cues: null } };
        await f.page.getByRole('link', { name: 'CueRelay', exact: true }).click();
        const settings = f.page.getByRole('link', { name: '项目设置', exact: true });
        // Exercise the same-tab route/key boundary without reloading the JS runtime.
        await settings.evaluate(node => { node.target = '_self'; });
        await settings.click();
        await expect(f.page).toHaveURL(origin + '/organizations/1/projects/8/settings');
        await selectFile(f.page, 'later.srt');
      }
      await f.release(oldPut);
      const section = f.page.getByRole('region', { name: '参考字幕', exact: true });
      await expect(section.getByRole('status')).toHaveCount(0);
      if (mode === 'disabled') {
        await expect(section).toContainText('已保存 1 段参考字幕。');
        await expect(section).toContainText('probe.srt');
      } else {
        await expect(section).toContainText('尚无参考字幕。');
        await expect(section).toContainText('later.srt');
        await expect(button(f.page, '上传参考字幕')).toBeEnabled();
      }
      assert.deepEqual(f.errors, []);
      console.log(`PASS settings ${mode}: obsolete write cannot change snapshot, candidate or feedback across lifetime boundary`);
    } finally { await f.context.close(); }
  }
}

try {
  for (const [name, run] of Object.entries({ reload: () => reloadReference(false), 'reload-clear': () => reloadReference(true),
    settings: () => settingsReference(false), 'settings-clear': () => settingsReference(true), lifetime: settingsLifetime, revision: reloadRevision })) {
    if (!only || only === name) await run();
  }
} finally { await browser.close(); }
