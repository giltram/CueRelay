// Real keyboard focus and local audio; isolated API fixtures, no database writes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { uiDocument } from './ass-codec.mjs';
import { unavailableAssPreview } from './ass-preview-fixture.mjs';

const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-subtitle-focus-'));
const file = join(artifacts, 'video.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
  'color=c=black:s=160x90:r=10:d=12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [], unexpected = [], checks = [];
const documentFixture = uiDocument();
let releaseImport;
page.on('pageerror', error => errors.push(String(error)));
await page.route('**/api/**', async route => {
  if (await unavailableAssPreview(route)) return;
  const request = route.request(), path = new URL(request.url()).pathname;
  const fixtures = {
    '/api/auth/session': { user: { id: 1, username: 'focus-fixture', is_dev: false } },
    '/api/organizations': { organizations: [] },
    '/api/me/settings': { shortcut_overrides: {}, audio_display_mode: 'spectrum', mouse_sets_cue_boundary: true },
    '/api/ass/empty': { document: documentFixture },
  };
  if (request.method() === 'GET' && fixtures[path]) return route.fulfill({ json: fixtures[path] });
  if (path === '/api/ass/styles' && request.postDataJSON().operation.type === 'inspect') {
    return route.fulfill({ json: { document: documentFixture, usage: {} } });
  }
  if (path === '/api/ass/import') {
    await new Promise(resolve => { releaseImport = resolve; });
    return route.fulfill({ json: { document: documentFixture } });
  }
  unexpected.push(`${request.method()} ${path}`); return route.abort();
});
const main = page.locator('main');
const text = page.getByLabel('字幕中文文本');
const start = page.getByRole('textbox', { name: '入点', exact: true });
const end = page.getByRole('textbox', { name: '出点', exact: true });
const stage = page.locator('.audio-stage');
const rows = page.locator('.cue-list tbody tr');
const focused = locator => locator.evaluate(el => el === document.activeElement);
const snapshot = () => page.evaluate(() => ({
  rows: document.querySelector('.cue-list tbody').innerText,
  start: document.querySelector('[aria-label="入点"]').value,
  end: document.querySelector('[aria-label="出点"]').value,
  time: document.querySelector('video').currentTime,
  view: [document.querySelector('.audio-timeline').dataset.start, document.querySelector('.audio-timeline').dataset.end],
  scroll: [window.scrollX, window.scrollY],
}));
// Synthetic events only for flags a browser automation keyboard cannot generate.
const dispatchTab = (locator, flags = {}) => locator.evaluate((el, flags) => {
  const event = new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab', bubbles: true, cancelable: true, ...flags });
  el.dispatchEvent(event);
  return event.defaultPrevented;
}, flags);
try {
  await page.goto(`${process.env.SUBTITLE_FOCUS_URL || 'http://127.0.0.1:5173'}/workspace/local`);
  await text.waitFor();

  // This shortcut also works without media; toggling alone does not dirty a draft.
  await main.focus(); await page.keyboard.press('Tab'); assert(await focused(text));
  await page.keyboard.press('Tab'); assert(await focused(main));
  let unloadDialogs = 0;
  page.on('dialog', async dialog => { unloadDialogs++; await dialog.accept(); });
  await page.reload(); await text.waitFor(); assert.equal(unloadDialogs, 0);
  checks.push('focus works without video and does not dirty the document');

  await page.getByLabel('导入本地视频').setInputFiles(file);
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
  await start.fill('0:00:00.30'); await end.fill('0:00:01.80');
  await main.focus();
  const before = await snapshot();
  await page.keyboard.press('Tab'); assert(await focused(text));
  await page.keyboard.type('qwg');
  assert.equal(await text.inputValue(), 'qwg'); assert.equal(await rows.count(), 1);
  assert.equal(await page.locator('.audio-timeline').getAttribute('data-audition-phase'), 'idle');
  await text.evaluate(el => el.setSelectionRange(1, 2));
  await page.keyboard.press('Tab'); assert(await focused(main));
  const after = await snapshot();
  assert.deepEqual({ ...after, rows: before.rows }, before);
  await page.keyboard.press('Tab'); assert(await focused(text));
  assert.deepEqual(await text.evaluate(el => [el.selectionStart, el.selectionEnd]), [1, 2]);
  await page.keyboard.press('Tab');
  // Holding Tab switches once in either direction, and never falls into native traversal.
  for (const target of [text, main]) {
    await page.keyboard.down('Tab'); assert(await focused(target));
    await page.keyboard.down('Tab'); assert(await focused(target));
    await page.keyboard.up('Tab');
  }
  for (const key of ['KeyQ', 'KeyW']) {
    await page.keyboard.press(key);
    await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.auditionPhase === 'playing');
    await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.auditionPhase === 'finished');
  }
  assert.equal(await text.inputValue(), 'qwg');
  await page.keyboard.press('KeyG');
  assert.equal(await rows.count(), 2);
  assert.deepEqual(await rows.first().locator('.time-cell').allTextContents(), ['0:00:00.30', '0:00:01.80']);
  assert.equal(await page.getByRole('button', { name: '选择第 2 行', exact: true }).getAttribute('aria-pressed'), 'true');
  checks.push('qwg typing, Q/W/G recovery, cursor preservation, held Tab and unchanged drafts/media/viewport');

  for (const surface of [stage, page.getByRole('slider', { name: /^字幕入点/ })]) {
    await surface.focus(); await page.keyboard.press('Tab'); assert(await focused(text));
    await page.keyboard.press('Tab'); assert(await focused(main));
  }
  await start.focus(); await page.keyboard.press('Tab'); assert(await focused(end));
  await page.keyboard.press('Tab'); assert(await focused(text));
  await page.keyboard.press('Shift+Tab'); assert(await focused(end));
  const locate = page.getByRole('button', { name: '定位选中行', exact: true });
  await locate.focus(); await page.keyboard.press('Tab');
  assert(await focused(page.getByRole('button', { name: '删除选中行', exact: true })));
  for (const selector of ['.video-progress', '.audio-vertical-zoom input', '[role="scrollbar"]', '[role="separator"]']) {
    const controls = page.locator(selector);
    assert(await controls.count() > 0, selector);
    for (const control of await controls.all()) assert.equal(await dispatchTab(control), false, selector);
  }
  checks.push('audio surfaces toggle; inputs, buttons, ranges, scrollbar, separators and Shift+Tab keep native navigation');

  for (const target of [main, text]) {
    await target.focus();
    for (const flags of [{ shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }, { keyCode: 229 }]) {
      assert.equal(await dispatchTab(target, flags), false); assert(await focused(target));
    }
    await target.dispatchEvent('compositionstart');
    assert.equal(await dispatchTab(target), false); assert(await focused(target));
    await target.dispatchEvent('compositionend');
    await target.evaluate(el => el.addEventListener('keydown', event => event.preventDefault(), { once: true }));
    assert.equal(await dispatchTab(target), true); assert(await focused(target));
  }
  checks.push('IME composition, modifiers and previously handled events are protected');

  await page.getByRole('button', { name: '管理样式', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '本地样式管理', exact: true });
  await dialog.getByRole('button', { name: '关闭', exact: true }).focus();
  await page.keyboard.press('Tab');
  assert(await dialog.evaluate(el => el.contains(document.activeElement)));
  assert.equal(await dispatchTab(main), false);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();

  await page.getByLabel('导入基础 ASS').setInputFiles({ name: 'replacement.ass', mimeType: 'text/plain', buffer: Buffer.from('[Script Info]') });
  await page.getByRole('button', { name: '替换当前字幕', exact: true }).waitFor();
  await main.focus(); assert.equal(await dispatchTab(main), false); assert(await focused(main));
  await page.getByRole('button', { name: '替换当前字幕', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '正在转换' }).waitFor();
  assert.equal(await dispatchTab(main), false);
  await page.waitForFunction(() => document.querySelector('textarea').matches(':disabled'));
  assert(releaseImport); releaseImport();
  await page.waitForFunction(() => !document.querySelector('textarea').matches(':disabled'));
  checks.push('style dialog, import confirmation and busy conversion suspend focus shortcuts');

  await page.getByRole('button', { name: '切换视频全屏', exact: true }).click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  assert.equal(await dispatchTab(main), false);
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.getByRole('button', { name: '删除选中行', exact: true }).click();
  assert.equal(await rows.count(), 0);
  await main.focus(); assert.equal(await dispatchTab(main), false);
  checks.push('fullscreen and no selected row do not claim Tab');

  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  const report = { browser: browser.version(), checks, errors, unexpected };
  writeFileSync(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ artifacts, ...report }, null, 2));
} finally { releaseImport?.(); await browser.close(); }
