// Layout gestures with real local media; isolated APIs, no business database writes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { uiDocument } from './ass-codec.mjs';
import { unavailableAssPreview } from './ass-preview-fixture.mjs';

const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-workbench-resize-'));
const file = join(artifacts, 'video.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
  'color=c=black:s=160x90:r=10:d=8', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(10000);
const errors = [], unexpected = [], checks = [];
page.on('pageerror', error => errors.push(String(error)));
const documentFixture = uiDocument();
documentFixture.cues = Array.from({ length: 30 }, (_, index) => ({ id: `cue-${index}`, start_ms: index * 100,
  end_ms: index * 100 + 100, style_id: documentFixture.styles[0].id, text: `字幕 ${index + 1}` }));
await page.route('**/api/**', async route => {
  if (await unavailableAssPreview(route)) return;
  const path = new URL(route.request().url()).pathname;
  const fixtures = {
    '/api/auth/session': { user: { id: 1, username: 'resize', is_dev: false } },
    '/api/organizations': { organizations: [] },
    '/api/me/settings': { shortcut_overrides: {}, audio_display_mode: 'spectrum', mouse_sets_cue_boundary: true },
    '/api/ass/empty': { document: documentFixture },
  };
  if (fixtures[path]) return route.fulfill({ json: fixtures[path] });
  unexpected.push(path); return route.abort();
});
const separator = page.getByRole('separator', { name: '调整视频区域大小', exact: true });
const text = page.getByLabel('字幕中文文本');
const snapshot = () => page.evaluate(() => {
  const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
  const video = document.querySelector('video');
  return { upper: box('.workbench'), list: box('.cue-list'), media: box('.media-panel'), editor: box('.editing-panel'),
    frame: box('.video-stage'), text: document.querySelector('[aria-label="字幕中文文本"]').value,
    selected: document.querySelector('.row-number[aria-pressed="true"]')?.textContent,
    rows: [...document.querySelectorAll('.cue-text')].map(el => el.textContent),
    sameVideo: video === window.resizeVideo, time: video.currentTime, paused: video.paused,
    resizing: document.querySelector('.workbench').hasAttribute('data-resizing'),
    pageFits: document.documentElement.scrollHeight <= innerHeight && document.documentElement.scrollWidth <= innerWidth };
});
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const near = (actual, expected, description) => assert(Math.abs(actual - expected) < 1, `${description}: ${actual} vs ${expected}`);
function statePreserved(before, after) {
  assert.deepEqual([after.text, after.selected, after.rows, after.time, after.paused], [before.text, before.selected, before.rows, before.time, before.paused]);
  assert(after.sameVideo); assert(after.list.height >= 144); assert(after.editor.width >= 479);
  assert(Math.abs(after.frame.width / after.frame.height - 16 / 9) < .01, 'video keeps 16:9'); assert(after.pageFits);
}
async function startDrag() {
  const box = await separator.boundingBox();
  const point = { x: box.x + box.width / 2, y: box.y + 40 };
  await page.mouse.move(point.x, point.y); await page.mouse.down(); return point;
}
try {
  await page.goto(`${process.env.WORKBENCH_RESIZE_URL || 'http://127.0.0.1:5173'}/workspace/local`);
  await page.getByLabel('导入本地视频').setInputFiles(file);
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
  await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  await text.fill('保留正文和未提交的时间草稿'); await page.getByRole('textbox', { name: '入点', exact: true }).fill('0:00:00.03');
  await page.locator('video').evaluate(video => { window.resizeVideo = video; }); await settle();
  const initial = await snapshot();
  const start = await startDrag();
  await page.mouse.move(start.x + 100, start.y, { steps: 8 }); await settle();
  const grown = await snapshot();
  assert(grown.upper.height > initial.upper.height + 50); assert(grown.frame.width > initial.frame.width + 95);
  near(grown.upper.height - initial.upper.height, initial.list.height - grown.list.height, 'height transferred from subtitle list');
  statePreserved(initial, grown);
  await page.mouse.move(start.x, start.y, { steps: 8 }); await settle();
  const reversed = await snapshot(); near(reversed.upper.height, initial.upper.height, 'reverse restores baseline height');
  near(reversed.list.height, initial.list.height, 'reverse restores subtitle space');
  await page.mouse.move(3000, start.y, { steps: 10 }); await page.mouse.up(); await settle();
  const editorLimit = await snapshot(); near(editorLimit.editor.width, 480, 'editor width minimum'); statePreserved(initial, editorLimit);
  checks.push('continued rightward drag grows the actual 16:9 video and upper row; reverse returns height; editor stops at 480px without changing subtitles/media');

  await page.setViewportSize({ width: 1920, height: 900 }); await settle();
  const wideStart = await startDrag(); await page.mouse.move(3000, wideStart.y, { steps: 10 }); await page.mouse.up(); await settle();
  const subtitleLimit = await snapshot(); near(subtitleLimit.list.height, 144, 'subtitle minimum'); statePreserved(initial, subtitleLimit);
  await page.screenshot({ path: join(artifacts, 'expanded-minimum-subtitles.png') });
  await page.setViewportSize({ width: 1440, height: 600 }); await settle();
  const short = await snapshot(); statePreserved(initial, short); assert(short.upper.height < subtitleLimit.upper.height);
  near(short.list.height, 144, 'short window keeps subtitle minimum');
  checks.push('large preview reaches the subtitle 144px minimum; shrinking the viewport reclamps both dimensions and keeps the page within the viewport');

  await page.setViewportSize({ width: 1440, height: 900 }); await settle();
  await separator.dblclick({ position: { x: 8, y: 40 } }); await settle();
  const reset = await snapshot(); near(reset.upper.height, initial.upper.height, 'double click restores initial height');
  near(reset.media.width, initial.media.width, 'double click restores default width');
  await separator.focus(); await page.keyboard.press('End'); await settle();
  assert((await snapshot()).upper.height > reset.upper.height); await page.keyboard.press('Home'); await settle();
  near((await snapshot()).media.width, 300, 'keyboard Home');
  near((await snapshot()).upper.height, initial.upper.height, 'keyboard shrink restores height');
  checks.push('double click resets width/height together; keyboard End grows and Home shrinks using the same bounds');

  await startDrag(); await page.setViewportSize({ width: 390, height: 844 }); await settle();
  assert.equal(await separator.isVisible(), false); assert.equal((await snapshot()).resizing, false);
  await page.mouse.up(); await page.setViewportSize({ width: 1440, height: 900 }); await settle();
  assert.equal((await snapshot()).resizing, false); assert((await snapshot()).sameVideo);
  assert.equal(await page.getByRole('textbox', { name: '入点', exact: true }).inputValue(), '0:00:00.03');
  await separator.focus(); await page.keyboard.press('End'); await settle();
  const beforeHide = await snapshot();
  await page.getByRole('link', { name: 'CueRelay', exact: true }).click();
  await page.locator('main.editor-workbench').waitFor({ state: 'hidden' });
  await page.goBack(); await page.locator('main.editor-workbench').waitFor({ state: 'visible' }); await settle();
  const restored = await snapshot();
  near(restored.upper.height, beforeHide.upper.height, 'history restores requested height');
  near(restored.media.width, beforeHide.media.width, 'history restores requested width');
  statePreserved(beforeHide, restored);
  await page.screenshot({ path: join(artifacts, 'restored-workspace.png') });
  checks.push('breakpoint change releases an active pointer gesture; desktop return keeps the same video and uncommitted timing draft');
  checks.push('same-document hide/history return restores expanded proportions without replacing the video or caption draft');
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  const report = { browser: browser.version(), checks, errors, unexpected };
  writeFileSync(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ artifacts, ...report }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ artifacts, errors, unexpected }));
  await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true });
  throw error;
} finally { await browser.close(); }
