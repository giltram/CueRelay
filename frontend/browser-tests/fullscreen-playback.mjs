// Real Fullscreen API and MP4 playback; isolated identity fixtures, no database writes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { uiDocument } from './ass-codec.mjs';
import { unavailableAssPreview } from './ass-preview-fixture.mjs';

const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-fullscreen-playback-'));
console.log(`artifacts: ${artifacts}`);
const file = join(artifacts, 'video.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
  'testsrc2=size=320x180:rate=25:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
context.setDefaultTimeout(10000);
const page = await context.newPage();
const errors = [], unexpected = [];
let overrides = {};
page.on('pageerror', error => errors.push(String(error)));
await context.route('**/api/**', async route => {
  if (await unavailableAssPreview(route)) return;
  const fixtures = {
    '/api/auth/session': { user: { id: 1, username: 'fullscreen-fixture', is_dev: false } },
    '/api/organizations': { organizations: [] },
    '/api/me/settings': { shortcut_overrides: overrides, audio_display_mode: 'waveform', mouse_sets_cue_boundary: true },
    '/api/ass/empty': { document: uiDocument() },
  };
  const request = route.request(), path = new URL(request.url()).pathname;
  if (request.method() === 'GET' && fixtures[path]) return route.fulfill({ json: fixtures[path] });
  unexpected.push(`${request.method()} ${path}`); return route.abort();
});
const video = page.locator('video');
const fullscreen = page.getByRole('button', { name: '切换视频全屏', exact: true });
const main = page.locator('main');
const start = page.getByRole('textbox', { name: '入点', exact: true });
const end = page.getByRole('textbox', { name: '出点', exact: true });
// fullscreenElement changes before fullscreenchange dispatch + React's icon update.
const active = () => page.waitForFunction(() => document.fullscreenElement === document.querySelector('.video-stage')
  && document.querySelector('.video-fullscreen')?.getAttribute('aria-pressed') === 'true');
const normal = () => page.waitForFunction(() => document.fullscreenElement === null
  && document.querySelector('.video-fullscreen')?.getAttribute('aria-pressed') === 'false');
const playingPast = time => page.waitForFunction(time => {
  const video = document.querySelector('video');
  return !video.paused && !video.seeking && video.currentTime > time;
}, time);
async function seek(time) {
  await video.evaluate((el, time) => { el.currentTime = time; }, time);
  await page.waitForFunction(time => !document.querySelector('video').seeking && Math.abs(document.querySelector('video').currentTime - time) < .15, time);
}
async function previewSelection() {
  await main.focus(); await page.keyboard.press('Space');
  await playingPast(.05);
}
try {
  await page.goto(`${process.env.FULLSCREEN_PLAYBACK_URL || 'http://127.0.0.1:5173'}/workspace/local`);
  await page.getByLabel('导入本地视频').setInputFiles(file);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.getByLabel('字幕中文文本').fill('保留字幕与时间草稿');
  const rows = await page.locator('.cue-list tbody').innerText();
  const videoIdentity = await video.elementHandle();
  const rect = await fullscreen.boundingBox();
  assert.equal(rect.width, 28); assert.equal(rect.height, 28);
  assert.equal(await fullscreen.innerText(), '');
  assert.equal(await fullscreen.locator('svg').getAttribute('width'), '16');
  assert.equal(await fullscreen.getAttribute('title'), '进入全屏');
  const enterIcon = await fullscreen.locator('path').getAttribute('d');
  await fullscreen.screenshot({ path: join(artifacts, 'fullscreen-icon.png') });

  // Ordinary Space still auditions the subtitle and stops at its end.
  await previewSelection();
  await seek(1.9);
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return video.paused && Math.abs(video.currentTime - 2) < .02;
  });
  await seek(3.5);
  // Entering fullscreen while paused never seeks or starts playback by itself.
  await fullscreen.click(); await active();
  assert.equal(await fullscreen.getAttribute('aria-pressed'), 'true');
  assert.equal(await fullscreen.getAttribute('title'), '退出全屏');
  assert.notEqual(await fullscreen.locator('path').getAttribute('d'), enterIcon);
  assert(await video.evaluate(el => el.paused && Math.abs(el.currentTime - 3.5) < .05));
  // A focused fullscreen button must not be reactivated by Space.
  await fullscreen.focus(); await page.keyboard.press('Space');
  await playingPast(3.7); await active();
  await page.keyboard.press('Space');
  assert(await video.evaluate(el => el.paused && el.currentTime > 3.5));
  // Held Space toggles once; repeat keydown cannot immediately pause it again.
  await page.keyboard.down('Space'); await playingPast(3.8);
  await page.keyboard.down('Space'); await playingPast(3.9);
  await page.keyboard.up('Space'); await active();
  await fullscreen.screenshot({ path: join(artifacts, 'exit-fullscreen-icon.png') });
  await fullscreen.click(); await normal();
  assert(await video.evaluate(el => !el.paused && el.currentTime > 3.9));
  assert.equal(await fullscreen.getAttribute('aria-pressed'), 'false');
  assert.equal(await fullscreen.locator('path').getAttribute('d'), enterIcon);

  // Restore the normal selection shortcut, then enter while it is still active.
  await previewSelection();
  await fullscreen.click(); await active();
  assert(await video.evaluate(el => !el.paused));
  await seek(3); await playingPast(3.2);
  // Browser-driven exits also deliver fullscreenchange; headless Chromium does
  // not turn a synthetic Escape into its native fullscreen browser command.
  await page.evaluate(() => document.exitFullscreen()); await normal();
  await playingPast(3.4);
  await video.evaluate(el => el.pause());
  await previewSelection();
  await seek(1.9);
  await page.waitForFunction(() => document.querySelector('video').paused && Math.abs(document.querySelector('video').currentTime - 2) < .02);

  // Fullscreen playback ignores incomplete timing drafts and an unbound Space preference.
  await start.fill('0:'); await end.fill('invalid');
  overrides = { selection: ['KeyS'] };
  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/api/me/settings'),
    page.evaluate(() => window.dispatchEvent(new Event('focus'))),
  ]);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await fullscreen.click(); await active();
  await fullscreen.focus(); await page.keyboard.press('Space'); await playingPast(2.2);
  await page.keyboard.press('Space'); assert(await video.evaluate(el => el.paused));
  await fullscreen.click(); await normal();
  const pausedAt = await video.evaluate(el => el.currentTime);
  await main.focus(); await page.keyboard.press('Space');
  assert(await video.evaluate((el, at) => el.paused && Math.abs(el.currentTime - at) < .02, pausedAt));
  assert.equal(await start.inputValue(), '0:'); assert.equal(await end.inputValue(), 'invalid');
  assert.equal(await page.locator('.cue-list tbody').innerText(), rows);
  assert(await videoIdentity.evaluate(el => el === document.querySelector('video')));
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  const result = { checks: ['28px icon button', 'enter/exit icons', 'normal range audition', 'paused entry preserves time', 'fullscreen Space play/pause on button focus', 'repeat suppression', 'active audition cancelled on entry', 'external fullscreen exit preserves continuous playback', 'normal shortcuts/preferences restored', 'invalid timing drafts preserved', 'same video and subtitle content'], errors, unexpected, artifacts };
  writeFileSync(join(artifacts, 'result.json'), JSON.stringify(result, null, 2));
  console.log('PASS', JSON.stringify(result));
} catch (error) {
  console.error(error);
  await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally { await context.close(); await browser.close(); }
