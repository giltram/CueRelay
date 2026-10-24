import { emptyDocument, splitOnBackend } from './backend-split-fixture.mjs';
import { checkProjectSplits } from './project-split-checks.mjs';
// Real browser input, with isolated HTTP fixtures and real local media analysis.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
const dir = mkdtempSync(join(tmpdir(), 'cuerelay-editing-'));
const file = join(dir, 'tone.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=20',
  '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=20', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
let settings = { audio_display_mode: 'spectrum', shortcut_overrides: {}, mouse_sets_cue_boundary: true };
const errors = [], unexpected = [];
const splitRequests = [];
let failNextSplit = false, holdNextSplit = false, releaseSplit;
await context.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  if (path === '/api/ass/split') {
    splitRequests.push(request.postDataJSON());
    if (holdNextSplit) {
      holdNextSplit = false;
      await new Promise(resolve => { releaseSplit = resolve; });
    }
    if (failNextSplit) {
      failNextSplit = false;
      return route.fulfill({ status: 503, json: { issues: [{ message: '拆分保存失败' }] } });
    }
    const result = splitOnBackend(request.postDataJSON());
    return route.fulfill({ status: result.status, json: result.body });
  }
  if (path === '/api/me/settings'  && request.method() === 'PATCH') {
    settings = { ...settings, ...request.postDataJSON() };
    return route.fulfill({ json: settings });
  }
  const fixtures = {
    '/api/auth/session': { user: { id: 1, username: 'editing-fixture', is_dev: false } },
    '/api/organizations': { organizations: [] }, '/api/me/settings': settings,
    '/api/ass/empty': { document: emptyDocument },
  };
  if (fixtures[path]) return route.fulfill({ json: fixtures[path] });
  unexpected.push(`${request.method()} ${path}`); await route.abort();
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(String(error)));
async function refreshSettings() {
  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/me/settings'),
    page.evaluate(() => window.dispatchEvent(new Event('focus'))),
  ]);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function preference(value) {
  const popup = context.waitForEvent('page');
  await page.getByRole('link', { name: '设置', exact: true }).click();
  const panel = await popup;
  await panel.getByLabel('鼠标点击设置字幕边界', { exact: true }).setChecked(value);
  const checkbox = panel.getByLabel('鼠标点击设置字幕边界', { exact: true });
  assert.equal(await checkbox.evaluate(el => el.closest('form') !== null), false);
  const alignment = await checkbox.evaluate(el => {
    const box = el.getBoundingClientRect(), label = el.parentElement.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(el.parentElement.lastChild);
    const text = range.getBoundingClientRect();
    return { boxWidth: box.width, gap: text.left - box.right, centerDifference: Math.abs((box.top + box.bottom - text.top - text.bottom) / 2), leftDifference: Math.abs(box.left - label.left) };
  });
  assert.equal(alignment.boxWidth, 16); assert(alignment.gap >= 6 && alignment.gap <= 10);
  assert(alignment.centerDifference < 3); assert(alignment.leftDifference < 1);
  assert.equal(await checkbox.evaluate(el => {
    let sibling = el.parentElement.previousElementSibling;
    return sibling?.tagName === 'H2' && sibling.textContent === '快捷键';
  }), true);
  await panel.screenshot({ path: join(dir, 'mouse-settings-desktop.png'), fullPage: true });
  await panel.setViewportSize({ width: 390, height: 844 });
  const mobile = await checkbox.evaluate(el => {
    const box = el.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(el.parentElement.lastChild);
    const text = range.getBoundingClientRect();
    return { width: box.width, gap: text.left - box.right, centerDifference: Math.abs((box.top + box.bottom - text.top - text.bottom) / 2), overflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert.equal(mobile.width, 16); assert(mobile.gap >= 6 && mobile.gap <= 10);
  assert(mobile.centerDifference < 3); assert.equal(mobile.overflow, false);
  await panel.screenshot({ path: join(dir, 'mouse-settings-mobile.png'), fullPage: true });
  await panel.setViewportSize({ width: 1440, height: 1000 });
  // Saving audio mode must neither save nor reset the pending mouse preference.
  const previous = settings.mouse_sets_cue_boundary;
  await panel.getByRole('button', { name: '保存显示设置', exact: true }).click();
  await panel.getByText('已保存', { exact: true }).waitFor();
  assert.equal(settings.mouse_sets_cue_boundary, previous);
  assert.equal(await checkbox.isChecked(), value);
  await panel.getByRole('button', { name: '保存快捷键', exact: true }).click();
  await panel.getByText('已保存', { exact: true }).waitFor();
  await panel.reload();
  assert.equal(await panel.getByLabel('鼠标点击设置字幕边界', { exact: true }).isChecked(), value);
  await panel.close();
  await refreshSettings();
}
const start = page.getByRole('textbox', { name: '入点', exact: true });
const end = page.getByRole('textbox', { name: '出点', exact: true });
const stage = page.locator('.audio-stage');
const rows = page.locator('.cue-list tbody tr');
const savedTimes = () => rows.first().locator('.time-cell').allTextContents();
async function click(time, button = 'left', ruler = false) {
  const rect = await stage.boundingBox();
  const view = await page.locator('.audio-timeline').evaluate(el => [Number(el.dataset.start), Number(el.dataset.end)]);
  await stage.click({ button, position: { x: (time - view[0]) / (view[1] - view[0]) * rect.width, y: ruler ? 5 : rect.height * 0.65 } });
}
try {
  await page.goto(process.env.EDITING_URL || 'http://127.0.0.1:5189/workspace/local');
  await page.waitForFunction(() => !document.querySelector('.file-actions button.primary')?.disabled);
  await page.getByLabel('导入本地视频').setInputFiles(file);
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
  await click(1); await click(4, 'right');
  assert.equal(await start.inputValue(), '0:00:01.00');
  assert.equal(await end.inputValue(), '0:00:04.00');
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 0);
  await page.keyboard.press('KeyG');
  assert.deepEqual(await savedTimes(), ['0:00:01.00', '0:00:04.00']);
  assert.equal(await rows.count(), 2);
  await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  const before = await savedTimes();
  await preference(false);
  await click(2.3);
  await page.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 2.3) < .02);
  assert.equal(await page.locator('video').evaluate(video => video.paused), true);
  await click(3.2, 'right');
  assert.equal(await start.inputValue(), '0:00:01.00'); assert.equal(await end.inputValue(), '0:00:04.00');
  await click(2.8, 'left', true);
  await page.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 2.8) < .02);
  await page.locator('video').evaluate(video => video.play());
  await click(5.2);
  assert.equal(await page.locator('video').evaluate(video => video.paused), false);
  await page.locator('video').evaluate(video => video.pause());
  assert.deepEqual(await savedTimes(), before);
  // Existing boundary drags remain available in seek-click mode.
  const boundary = page.getByRole('slider', { name: /^字幕入点/ });
  const box = await boundary.boundingBox(), rect = await stage.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(rect.x + rect.width * .15, box.y + box.height / 2, { steps: 5 }); await page.mouse.up();
  assert.equal(await start.inputValue(), '0:00:01.50');
  await preference(true);
  await click(1.2); await click(3.8, 'right');
  assert.equal(await start.inputValue(), '0:00:01.20'); assert.equal(await end.inputValue(), '0:00:03.80');
  // Bind trim commands via the existing settings list.
  settings.shortcut_overrides = { 'set-start-playhead': ['Ctrl+KeyB'], 'set-end-playhead': ['Ctrl+KeyM'] };
  await refreshSettings();
  await page.locator('video').evaluate(video => { video.currentTime = 2; });
  await stage.focus(); await page.keyboard.press('Control+b');
  assert.deepEqual(await savedTimes(), ['0:00:02.00', '0:00:04.00']);
  assert.equal(await rows.count(), 2);
  await page.locator('video').evaluate(video => { video.currentTime = 3; });
  await page.keyboard.press('Control+m');
  assert.deepEqual(await savedTimes(), ['0:00:02.00', '0:00:03.00']);
  await page.locator('video').evaluate(video => { video.currentTime = 1; });
  await page.keyboard.press('Control+m');
  await page.getByRole('alert').filter({ hasText: '入点必须早于出点' }).waitFor();
  assert.deepEqual(await savedTimes(), ['0:00:02.00', '0:00:03.00']);
  await stage.dispatchEvent('compositionstart'); await page.keyboard.press('Control+b'); await stage.dispatchEvent('compositionend');
  assert.deepEqual(await savedTimes(), ['0:00:02.00', '0:00:03.00']);
  await page.getByLabel('字幕中文文本').focus(); await page.keyboard.press('Control+b');
  assert.deepEqual(await savedTimes(), ['0:00:02.00', '0:00:03.00']);

  await page.getByRole('button', { name: '选择第 2 行', exact: true }).click();
  await page.getByRole('button', { name: '删除选中行', exact: true }).click();
  assert.equal(await rows.count(), 1);
  // Unconfigured Enter remains a normal ASS line break; a configured Enter
  // consumes exactly one split and must not also submit/advance the cue.
  const text = page.getByLabel('字幕中文文本');
  await text.fill(''); await text.press('Enter');
  assert.equal(await text.inputValue(), '\\N');
  await text.fill('今天下午我们一起去吧');
  await start.fill('0:00:10.00'); await end.fill('0:00:16.00');
  const popup = context.waitForEvent('page');
  await page.getByRole('link', { name: '设置', exact: true }).click();
  const panel = await popup;
  await panel.getByLabel('提交并下一条绑定', { exact: true }).fill('KeyG');
  await panel.getByLabel('在文本光标位置拆分字幕绑定', { exact: true }).fill('Enter');
  await panel.getByLabel('在播放头位置拆分字幕绑定', { exact: true }).fill('Ctrl+KeyT');
  await panel.getByRole('button', { name: '保存快捷键', exact: true }).click();
  await panel.getByText('已保存', { exact: true }).waitFor();
  await panel.close(); await refreshSettings();
  await text.focus(); await text.evaluate(el => el.setSelectionRange(4, 4));
  await text.dispatchEvent('compositionstart'); await text.press('Enter'); await text.dispatchEvent('compositionend');
  assert.equal(splitRequests.length, 0);
  // The browser may insert a normal newline while our command is suppressed.
  await text.fill('今天下午我们一起去吧'); await text.evaluate(el => el.setSelectionRange(4, 4));
  holdNextSplit = true;
  await text.press('Enter');
  await page.waitForFunction(() => document.querySelector('textarea').matches(':disabled'));
  await page.keyboard.press('Enter');
  assert.equal(splitRequests.length, 1);
  releaseSplit();
  await page.waitForFunction(() => document.querySelectorAll('.cue-list tbody tr').length === 2);
  assert.equal(await text.inputValue(), '今天下午');
  assert.deepEqual(await savedTimes(), ['0:00:10.00', '0:00:12.40']);
  // Real row renderer also exposes each cue via its selection button.
  assert((await rows.nth(1).innerText()).includes('我们一起去吧'));
  assert.equal(await rows.count(), 2);
  assert.equal(await text.evaluate(el => el === document.activeElement), true);

  // Endpoint and selected-range failures leave text and row count untouched.
  await text.evaluate(el => el.setSelectionRange(0, 0)); await text.press('Enter');
  await page.getByRole('alert').filter({ hasText: '光标必须严格位于文本内部' }).waitFor();
  assert.equal(await text.inputValue(), '今天下午'); assert.equal(await rows.count(), 2);
  assert.equal(await text.evaluate(el => el === document.activeElement && el.selectionStart === 0), true);
  await text.evaluate(el => el.setSelectionRange(1, 2)); await text.press('Enter');
  await page.getByRole('alert').filter({ hasText: '不能拆分选中文字' }).waitFor();
  assert.equal(await rows.count(), 2);
  await text.fill('甲\\N乙'); await text.evaluate(el => el.setSelectionRange(1, 1)); await text.press('Enter');
  await page.getByRole('alert').filter({ hasText: '当前只支持普通文本拆分' }).waitFor();
  assert.equal(await text.inputValue(), '甲\\N乙');
  await text.fill('甲乙'); await start.fill('0:00:10.00'); await end.fill('0:00:10.01');
  await text.focus(); await text.evaluate(el => el.setSelectionRange(1, 1)); await text.press('Enter');
  await page.getByRole('alert').filter({ hasText: '时间须足够' }).waitFor();
  assert.equal(await rows.count(), 2); assert.equal(await end.inputValue(), '0:00:10.01');
  // A server error never applies a speculative split to the editor.
  await end.fill('0:00:16.00'); await text.focus(); await text.evaluate(el => el.setSelectionRange(1, 1));
  failNextSplit = true; await text.press('Enter');
  await page.getByRole('alert').filter({ hasText: '拆分保存失败' }).waitFor();
  assert.equal(await rows.count(), 2); assert.equal(await text.inputValue(), '甲乙');
  assert.equal(await text.evaluate(el => el === document.activeElement && el.selectionStart === 1), true);
  // Playhead split refuses text, then splits an empty axis without moving video.
  await page.locator('video').evaluate(video => { video.currentTime = 13; });
  await stage.focus(); await page.keyboard.press('Control+t');
  await page.getByRole('alert').filter({ hasText: '含有文本的字幕请使用文本光标拆分' }).waitFor();
  assert.equal(await rows.count(), 2);
  await text.fill(''); await stage.focus(); await page.keyboard.press('Control+t');
  await page.waitForFunction(() => document.querySelectorAll('.cue-list tbody tr').length === 3);
  assert.deepEqual(await savedTimes(), ['0:00:10.00', '0:00:13.00']);
  assert.deepEqual(await rows.nth(2).locator('.time-cell').allTextContents(), ['0:00:13.00', '0:00:16.00']);
  assert.deepEqual(await rows.nth(1).locator('.time-cell').allTextContents(), ['0:00:12.40', '0:00:16.00']);
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 13);
  assert.equal(splitRequests.at(-1).mode, 'playhead');
  await checkProjectSplits(browser, file, emptyDocument, splitOnBackend);
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log(JSON.stringify({ checks: ['default boundary clicks and G', 'preference saves with shortcuts and reloads', 'desktop and mobile checkbox alignment', 'audio save preserves unsaved mouse preference', 'paused and playing seeks', 'ruler seek', 'right click inert', 'boundary drag preserved', 'independent playhead trim', 'illegal ranges rejected', 'IME and textarea protection', 'actual text caret and one command per key', 'Unicode backend rules', 'split error recovery and time limits', 'empty playhead split'], errors, artifacts: dir }, null, 2));
} catch (error) { console.error('Browser state', await page.locator('body').innerText(), JSON.stringify(splitRequests.map(({ cue_id, mode, position }) => ({ cue_id, mode, position })))); throw error; } finally { await browser.close(); }
