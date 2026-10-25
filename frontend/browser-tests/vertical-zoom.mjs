import { uiDocument } from './ass-codec.mjs';
import { unavailableAssPreview } from './ass-preview-fixture.mjs';
// Rendering fixtures: real WebCodecs/Worker/Canvas, no account or database writes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { setAudioMode } from './audio-settings.mjs';
import { checkPlayhead } from './playhead-checks.mjs';
import { checkRuler, observeRuler } from './ruler-checks.mjs';

const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-vertical-zoom-'));
const file = join(artifacts, 'weak-tones.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
  'color=c=black:s=160x90:r=10:d=45', '-f', 'lavfi', '-i',
  'aevalsrc=0.002*sin(2*PI*1000*t)+0.125*sin(2*PI*3000*t):s=48000:d=45',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-af', "volume='if(lt(mod(t,4),2),1,0)':eval=frame",
  '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', file]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const errors = [], unexpected = [];
let settings = { shortcut_overrides: {}, audio_display_mode: 'spectrum' };
await context.route('**/api/**', async route => {
  if (await unavailableAssPreview(route)) return;
  const request = route.request(); const path = new URL(request.url()).pathname;
  const fixtures = {
    '/api/auth/session': { user: { id: 1, username: 'vertical-zoom-fixture', is_dev: false } },
    '/api/organizations': { organizations: [] }, '/api/me/settings': settings,
    '/api/ass/empty': { document: uiDocument(['Default']) },
  };
  if (request.method() === 'PATCH' && path === '/api/me/settings') {
    settings = { ...settings, ...request.postDataJSON() }; await route.fulfill({ json: settings });
  } else if (request.method() === 'GET' && fixtures[path]) await route.fulfill({ json: fixtures[path] });
  else { unexpected.push(`${request.method()} ${path}`); await route.abort(); }
});
const page = await context.newPage();
await observeRuler(page);
page.on('pageerror', error => errors.push(String(error)));
await page.addInitScript(() => {
  window.__zoomStats = { workers: 0, messages: 0, allocations: 0, paints: 0 };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) { super(...args); window.__zoomStats.workers++; }
    postMessage(...args) { window.__zoomStats.messages++; return super.postMessage(...args); }
  };
  const create = CanvasRenderingContext2D.prototype.createImageData;
  CanvasRenderingContext2D.prototype.createImageData = function (...args) {
    window.__zoomStats.allocations++; return create.apply(this, args);
  };
  const fill = CanvasRenderingContext2D.prototype.fillRect;
  CanvasRenderingContext2D.prototype.fillRect = function (...args) {
    if (args[0] === 0 && args[1] === 0 && this.canvas.matches('.audio-stage canvas')) window.__zoomStats.paints++;
    return fill.apply(this, args);
  };
});
const ready = () => page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
const painted = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const snapshot = () => page.evaluate(() => ({
  stats: { ...window.__zoomStats },
  view: [document.querySelector('.audio-timeline').dataset.start, document.querySelector('.audio-timeline').dataset.end],
  cache: document.querySelector('.audio-timeline').dataset.cacheBytes,
  decoded: document.querySelector('.audio-timeline').dataset.decodedSegments,
  time: document.querySelector('video').currentTime, volume: document.querySelector('video').volume,
  draft: [...document.querySelectorAll('.time-point input')].map(el => el.value),
  boundaries: [...document.querySelectorAll('.audio-boundary')].map(el => el.style.left),
}));
const brightness = () => page.locator('.audio-stage canvas').evaluate(canvas => {
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  const top = Math.ceil(36 * canvas.height / canvas.getBoundingClientRect().height);
  const total = [0, 0, 0]; const count = [0, 0, 0];
  for (let y = top; y < canvas.height - 15; y++) for (let x = 80; x < canvas.width - 10; x++) {
    const t = x / canvas.width * 10;
    // Active signal, inactive silence, normal signal; exclude labels and markers.
    const region = t < 1.8 ? 0 : t > 2.2 && t < 3.8 ? 1 : t > 4.2 ? 2 : -1;
    if (region < 0) continue;
    const i = (y * canvas.width + x) * 4;
    total[region] += pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722;
    count[region]++;
  }
  return total.map((value, i) => value / count[i]);
});
const report = { browser: browser.version(), artifacts, errors, unexpected };
try {
  await page.goto(new URL('/workspace/local', process.env.AUDIO_TIMELINE_URL || 'http://127.0.0.1:5173').href);
  await page.waitForFunction(() => document.querySelector('.file-actions button.primary')?.disabled === false);
  await page.getByLabel('导入本地视频').setInputFiles(file); await ready(); await painted();
  const slider = page.getByRole('slider', { name: '垂直缩放', exact: true });
  assert.equal(await slider.inputValue(), '1');
  assert.equal(await slider.getAttribute('min'), '0.5'); assert.equal(await slider.getAttribute('max'), '4');
  const stage = page.locator('.audio-stage');
  const stageBox = await stage.boundingBox(); const box = await slider.boundingBox();
  assert(box.x >= stageBox.x + stageBox.width && box.height > box.width);
  await stage.focus(); await page.keyboard.press('KeyG');
  await page.getByRole('button', { name: '选择第 1 行', exact: true }).click(); await painted();
  const before = await snapshot(); const normal = await brightness();
  await slider.focus(); await page.keyboard.press('Home'); await painted();
  assert.equal(await slider.inputValue(), '0.5'); const dim = await brightness();
  await page.keyboard.press('ArrowUp'); assert.equal(await slider.inputValue(), '0.51');
  await page.keyboard.press('ArrowDown'); assert.equal(await slider.inputValue(), '0.5'); await painted();
  await page.locator('.audio-visualization').screenshot({ path: join(artifacts, 'dim.png') });
  await page.keyboard.press('End'); await painted();
  assert.equal(await slider.inputValue(), '4'); const bright = await brightness();
  for (const i of [0, 2]) assert(bright[i] > normal[i] && normal[i] > dim[i]);
  assert(Math.abs(bright[1] - dim[1]) < .1);
  await page.locator('.audio-visualization').screenshot({ path: join(artifacts, 'bright.png') });
  await slider.dblclick(); await painted(); assert.equal(await slider.inputValue(), '1');
  assert.deepEqual(await brightness(), normal);
  await page.locator('.audio-visualization').screenshot({ path: join(artifacts, 'default.png') });
  const thumbY = box.y + 8 + (1 - (1 - .5) / 3.5) * (box.height - 16);
  await page.mouse.move(box.x + box.width / 2, thumbY); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 8, { steps: 25 }); await painted();
  assert(Number(await slider.inputValue()) > 3.5); // Live before mouseup.
  assert((await snapshot()).stats.paints > before.stats.paints);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 8, { steps: 25 }); await painted();
  assert(Number(await slider.inputValue()) < .7); await page.mouse.up();
  const after = await snapshot();
  for (const key of ['view', 'cache', 'decoded', 'time', 'volume', 'draft', 'boundaries']) assert.deepEqual(after[key], before[key], key);
  for (const key of ['workers', 'messages', 'allocations']) assert.equal(after.stats[key], before.stats[key], key);
  report.spectrum = { dim, normal, bright, before, after };
  await slider.focus(); await page.keyboard.press('End');
  await setAudioMode(page, 'waveform'); await ready(); await painted(); assert.equal(await slider.inputValue(), '4');
  const waveformExtent = () => page.locator('.audio-stage canvas').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let first = canvas.height, last = 0;
    for (let y = 30; y < canvas.height; y++) for (let x = 80; x < canvas.width - 10; x++) {
      const i = (y * canvas.width + x) * 4;
      if (pixels[i] > 70 && pixels[i] < 160 && pixels[i + 1] > 170 && pixels[i + 2] > 210) { first = Math.min(first, y); last = Math.max(last, y); }
    }
    return last - first;
  });
  const tall = await waveformExtent();
  await slider.focus(); await page.keyboard.press('Home'); await painted();
  const short = await waveformExtent(); assert(tall > short * 2); report.waveform = { tall, short };
  await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
  await page.keyboard.down('Shift'); await page.mouse.wheel(0, -120); await page.keyboard.up('Shift');
  await ready(); await painted(); assert.equal(await slider.inputValue(), '0.5');
  const view = (await snapshot()).view; assert(Number(view[1]) - Number(view[0]) < 10);
  await setAudioMode(page, 'spectrum'); await ready(); await painted(); assert.equal(await slider.inputValue(), '0.5');
  await page.getByRole('slider', { name: /^字幕出点/ }).focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('textbox', { name: '出点', exact: true }).inputValue(), '0:00:02.01');
  await page.locator('video').evaluate(video => { video.currentTime = 5; });
  const bounds = () => page.locator('.audio-timeline').evaluate(el => ({ start: Number(el.dataset.start), end: Number(el.dataset.end) }));
  report.playhead = await checkPlayhead(page, bounds);
  report.ruler = await checkRuler(page, artifacts);
  await page.setViewportSize({ width: 800, height: 900 }); await painted();
  const narrow = await slider.boundingBox(); assert(narrow.height > 24 && narrow.width >= 24);
  await page.screenshot({ path: join(artifacts, 'narrow.png') });
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({ path: join(artifacts, 'failure.png') }).catch(() => {});
  console.error('Vertical zoom artifacts:', artifacts, error); throw error;
} finally { await browser.close(); }
