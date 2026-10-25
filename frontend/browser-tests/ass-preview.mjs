// Real JASSUB Worker/WASM + backend codec, disposable HTTP identity fixtures.
// No database writes, uploaded video, or mocked subtitle renderer.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../..', import.meta.url));
const fixture = join(root, 'frontend/browser-tests/fixtures/preview.ass');
function parse(source) {
  return JSON.parse(execFileSync(join(root, '.venv/bin/python'), ['-c',
    'import sys,json; sys.path.insert(0,sys.argv[1]); from ass_format import parse_ass; print(json.dumps(parse_ass(sys.stdin.read())))',
    join(root, 'backend')], { input: source, encoding: 'utf8' }));
}
const initial = parse(readFileSync(fixture, 'utf8'));
const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-ass-preview-'));
console.log(`artifacts: ${artifacts}`);
const file = join(artifacts, 'video.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
  'color=c=0x101010:s=640x480:r=25:d=12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const errors = [], expectedWorkerFailures = [], outside = [], exports = [], workers = new Set();
page.on('pageerror', error => (blocked ? expectedWorkerFailures : errors).push(String(error)));
page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
page.on('worker', worker => { workers.add(worker); worker.on('close', () => workers.delete(worker)); });
page.on('request', request => {
  const url = new URL(request.url());
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol !== 'blob:' && url.protocol !== 'data:') outside.push(request.url());
  if (request.method() !== 'GET') assert(request.url().includes('/api/ass/'), `unexpected write ${request.url()}`);
});
const organization = { id: 1, name: 'preview fixture', role: 'member', is_active: true };
let remoteProject = { id: 1, organization_id: 1, name: 'remote fixture', description: '', status: 'active', revision: 1,
  created_at: '2026-10-24T00:00:00Z', updated_at: '2026-10-24T00:00:00Z', updated_by: { username: 'preview-fixture' },
  archived_at: null, archived_by: null, media: { sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
    size: readFileSync(file).length, duration_ms: 12000 }, document: initial };
let documentFixture = initial, holdNext = false, release, blocked = false;
await context.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  if (path === '/api/ass/export') {
    exports.push(request.postDataJSON().document);
    if (holdNext) { holdNext = false; await new Promise(resolve => { release = resolve; }); }
    return route.continue(); // actual stateless serializer, including errors
  }
  if (path === '/api/ass/import') return route.continue();
  const fixtures = {
    '/api/auth/session': { user: { id: 1, username: 'preview-fixture', is_dev: false } },
    '/api/organizations': { organizations: [organization] },
    '/api/me/settings': { shortcut_overrides: {}, audio_display_mode: 'waveform' },
    '/api/ass/empty': { document: documentFixture },
    '/api/organizations/1/projects/1': { project: remoteProject },
    '/api/organizations/1/projects/2': { project: { ...remoteProject, id: 2 } },
    '/api/organizations/1/projects': { projects: [remoteProject], total: 1, page: 1, has_more: false },
  };
  if (fixtures[path]) return route.fulfill({ json: fixtures[path] });
  throw new Error(`unexpected request ${request.method()} ${path}`);
});
await context.route('**/*.wasm*', route => blocked ? route.abort() : route.continue());
const base = process.env.ASS_PREVIEW_URL || 'http://127.0.0.1:5173';
if (process.env.ASS_PREVIEW_SINGLE_THREAD === '1') {
  await context.route(`${base}/**`, async route => {
    if (!route.request().isNavigationRequest()) return route.fallback();
    const response = await route.fetch();
    const headers = response.headers();
    delete headers['cross-origin-opener-policy']; delete headers['cross-origin-embedder-policy'];
    await route.fulfill({ response, headers });
  });
}
const video = page.locator('video'), canvas = page.locator('.ass-preview-canvas');
const text = page.getByRole('textbox', { name: '字幕中文文本', exact: true });
const rows = page.locator('.cue-list tbody tr');
async function ready() { await page.waitForFunction(() => document.querySelector('.ass-preview-status')?.dataset.phase === 'ready'); }
async function seek(time) {
  await video.evaluate((el, time) => { el.pause(); el.currentTime = time; }, time);
  await page.waitForFunction(time => !document.querySelector('video').seeking && Math.abs(document.querySelector('video').currentTime - time) < .05, time);
}
async function pixels(name) {
  const buffer = await page.locator('.video-stage').screenshot();
  if (name) writeFileSync(join(artifacts, `${name}.png`), buffer);
  return page.evaluate(async base64 => {
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const img = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(img.width, img.height), ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0); img.close();
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let white = 0, yellow = 0, red = 0, hash = 0, minX = width, maxX = 0;
    for (let y = Math.floor(height * .25); y < height - 5; y++) for (let x = 5; x < width - 5; x++) {
      const i = (y * width + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      if (r > 140 && g > 140 && b > 140 && Math.max(r, g, b) - Math.min(r, g, b) < 12) white++;
      if (r > 140 && g > 140 && b < 80) yellow++;
      if (r > 140 && g < 80 && b < 80) red++;
      if (r > 140 && g > 140) { hash = (hash + (x + y * width) * (r + g + b)) % 1000000007; minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    }
    return { white, yellow, red, hash, minX, maxX, width, height };
  }, buffer.toString('base64'));
}
async function eventually(check) {
  const until = Date.now() + 8000;
  let result;
  do { result = await pixels(); if (check(result)) return result; } while (Date.now() < until);
  assert.fail(`render condition not met: ${JSON.stringify(result)}`);
}
async function edit(value) {
  const response = page.waitForResponse(res => res.url().includes('/api/ass/export'));
  await text.fill(value); await response; await ready();
}
async function importFile(file) {
  await page.getByLabel('导入基础 ASS').setInputFiles(file);
  const replace = page.getByRole('button', { name: '替换当前字幕' });
  if (await replace.isVisible()) await replace.click();
  await rows.first().waitFor();
}
try {
  await page.goto(`${base}/workspace/local`);
  await page.getByLabel('导入本地视频').setInputFiles(file);
  await ready(); await seek(2.8);
  const initialWorkers = workers.size;
  const overlap = await eventually(p => p.white > 200 && p.yellow > 200);
  await pixels('01-chinese-overlap');
  assert.equal(await canvas.count(), 1);
  assert.equal(await canvas.evaluate(el => getComputedStyle(el).pointerEvents), 'none');
  const originalCanvas = await canvas.elementHandle();
  await rows.first().click();
  await edit('即时预览：新的中文台词');
  await eventually(p => p.hash !== overlap.hash && p.white > 200 && p.yellow > 200);
  assert(await originalCanvas.evaluate(el => el === document.querySelector('.ass-preview-canvas')));
  await pixels('02-edited-paused');

  // Timing draft affects preview before G/Enter, without changing saved row timing.
  const start = page.getByRole('textbox', { name: '入点', exact: true });
  const end = page.getByRole('textbox', { name: '出点', exact: true });
  await start.fill('0:00:03.00');
  await eventually(p => p.white === 0 && p.yellow > 200);
  assert.match(await rows.first().textContent(), /0:00:01.20/);
  await end.fill('0:00:06.00'); await start.fill('0:00:01.20');
  await seek(5); await eventually(p => p.white > 200 && p.yellow === 0);
  await page.locator('main').focus(); await page.keyboard.press('KeyG');
  assert.match(await rows.first().textContent(), /0:00:06.00/);

  // Switch style, create a final cue, then delete all: no stale last subtitle.
  await rows.first().click();
  await page.getByRole('combobox', { name: '字幕样式' }).selectOption({ label: 'Emphasis' });
  await eventually(p => p.white === 0 && p.yellow > 200);
  await pixels('03-style-yellow');
  await rows.last().click(); await start.fill('0:00:06.00'); await end.fill('0:00:08.00');
  await page.locator('main').focus(); await page.keyboard.press('KeyG');
  assert.equal(await rows.count(), 3);
  await edit('新建字幕'); await seek(8.5); await eventually(p => p.yellow > 100);
  await page.getByRole('button', { name: '删除选中行' }).click();
  await eventually(p => p.yellow === 0 && p.white === 0);
  while (await rows.count()) {
    await rows.first().click(); await page.getByRole('button', { name: '删除选中行' }).click();
  }
  await eventually(p => p.yellow === 0 && p.white === 0);

  // Restore a real ASS through the normal importer.
  await importFile(fixture);
  await rows.first().waitFor(); await seek(2.8); await eventually(p => p.white > 200 && p.yellow > 200);
  // Reimport populates the v2 structured Style/PlayRes snapshot. Accepting it
  // through the existing importer must update the track without a new renderer.
  const restyled = readFileSync(fixture, 'utf8').replace('Missing Preview Font,32,&H00FFFFFF', 'Noto Sans SC,60,&H000000FF');
  await importFile({ name: 'restyled.ass', mimeType: 'text/plain', buffer: Buffer.from(restyled) });
  await eventually(p => p.red > 800 && p.yellow > 200 && p.white === 0);
  await pixels('03-project-style-definition');
  assert(await originalCanvas.evaluate(el => el === document.querySelector('.ass-preview-canvas')));
  await importFile(fixture); await eventually(p => p.white > 200 && p.yellow > 200 && p.red === 0);
  await rows.first().click();
  // Fast typing stays on one instance and only serializes the coalesced snapshot.
  const conversionsBefore = exports.length;
  const beforeRapid = (await pixels()).hash;
  const finalRapid = 'rapid typing 最终字幕内容';
  await text.fill('');
  await text.pressSequentially(finalRapid, { delay: 8 });
  const lastInput = performance.now();
  await page.waitForResponse(res => res.url().includes('/api/ass/export') && res.request().postDataJSON().document.cues[0]?.text === finalRapid);
  await eventually(p => p.hash !== beforeRapid && p.white > 200 && p.yellow > 200);
  const rapidLatencyMs = Math.round(performance.now() - lastInput);
  const rapidConversions = exports.length - conversionsBefore;
  assert(rapidConversions <= 2, `typing produced ${rapidConversions} conversions`);
  assert(await originalCanvas.evaluate(el => el === document.querySelector('.ass-preview-canvas')));
  // Let the converter's older response arrive after a newer edit.
  holdNext = true; await text.fill('过期版本');
  await page.waitForResponse(async res => res.url().includes('/api/ass/export') && res.request().postDataJSON()?.document?.cues[0]?.text === '过期版本', { timeout: 500 }).catch(() => {});
  assert(release);
  await edit('最新版本');
  const newest = await eventually(p => p.white > 200 && p.yellow > 200);
  release(); await page.waitForTimeout(250);
  assert.equal((await pixels()).hash, newest.hash);

  // Invalid partial override hides stale content; valid text recovers the same engine.
  await text.fill('{');
  await page.waitForFunction(() => document.querySelector('.ass-preview-status')?.dataset.phase === 'error');
  await eventually(p => p.white === 0 && p.yellow === 0);
  await edit('恢复中文，继续预览'); await eventually(p => p.white > 200 && p.yellow > 200);
  assert(await originalCanvas.evaluate(el => el === document.querySelector('.ass-preview-canvas')));

  // Playback clears gaps; seeking back while paused repaints overlap.
  await video.evaluate(el => { el.currentTime = 3.8; void el.play(); });
  await page.waitForFunction(() => document.querySelector('video').currentTime > 4.3);
  await video.evaluate(el => el.pause()); await eventually(p => p.white === 0 && p.yellow === 0);
  await seek(2.8); await eventually(p => p.white > 200 && p.yellow > 200);

  // Actual 4:3 picture inside a 16:9 stage; pause/resize/fullscreen retain geometry.
  for (const width of [1000, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await eventually(p => p.white > 40 && p.yellow > 40);
    const rect = await canvas.evaluate(el => {
      const r = el.getBoundingClientRect(), v = document.querySelector('video').getBoundingClientRect();
      return { w: r.width, h: r.height, x: r.x, vx: v.x, vw: v.width };
    });
    assert(Math.abs(rect.w / rect.h - 4 / 3) < .02);
    assert(Math.abs(rect.x - (rect.vx + (rect.vw - rect.w) / 2)) < 2);
    await pixels(`04-layout-${width}`);
  }
  await page.getByRole('button', { name: '切换视频全屏' }).click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  await eventually(p => p.white > 200 && p.yellow > 200); await pixels('05-fullscreen');
  await page.evaluate(() => document.exitFullscreen());

  const toggle = page.getByRole('button', { name: '显示字幕', exact: true });
  await toggle.click(); await eventually(p => p.white === 0 && p.yellow === 0);
  await toggle.click(); await ready(); await eventually(p => p.white > 200 && p.yellow > 200);
  await page.waitForTimeout(350);
  assert.equal(await canvas.count(), 1);
  // Failure path and retry use real failed WASM loads, while video stays usable.
  await toggle.click(); blocked = true; await toggle.click();
  await page.waitForFunction(() => document.querySelector('.ass-preview-status')?.dataset.phase === 'error');
  await page.waitForTimeout(350); assert.equal(await canvas.count(), 0);
  await video.evaluate(el => { el.currentTime = 5; });
  blocked = false; await toggle.click(); await toggle.click(); await ready();
  await seek(2.8); await eventually(p => p.white > 200 && p.yellow > 200);
  const finalWorkers = workers.size;
  assert.equal(finalWorkers, initialWorkers, `worker count must return to initial ${initialWorkers}, got ${finalWorkers}`);
  assert.deepEqual(outside, []); assert.deepEqual(errors, []);
  const result = { browser: browser.version(), isolated: await page.evaluate(() => crossOriginIsolated), artifacts, overlap, finalWorkers, exports: exports.length,
    latestText: exports.at(-1).cues[0].text, rapidLatencyMs, rapidConversions, outside, errors, expectedWorkerFailures };
  // A project observes remote commits only via its existing explicit reload.
  // Do not bypass that contract with preview-specific polling or a new store.
  page.on('dialog', dialog => dialog.accept());
  await page.goto(`${base}/organizations/1/projects/1/workspace`);
  await page.getByLabel('导入本地视频').setInputFiles(file); await ready(); await seek(2.8);
  await eventually(p => p.white > 200 && p.yellow > 200);
  remoteProject = { ...remoteProject, revision: 2, document: { ...initial, cues: initial.cues.slice(1) } };
  await page.getByRole('button', { name: '重新加载项目', exact: true }).click();
  const discard = page.getByRole('button', { name: /明确放弃/ });
  if (await discard.isVisible()) await discard.click();
  await page.waitForFunction(() => document.querySelectorAll('.cue-list tbody tr').length === 1 && !document.querySelector('video').getAttribute('src'));
  await page.getByLabel('导入本地视频').setInputFiles(file); await ready(); await seek(2.8);
  await eventually(p => p.white === 0 && p.yellow > 200);
  assert.equal(await rows.count(), 1);
  for (const id of [2, 1]) {
    await page.goto(`${base}/organizations/1/projects/${id}/workspace`);
    await page.getByLabel('导入本地视频').setInputFiles(file); await ready(); await seek(2.8);
    await eventually(p => p.white === 0 && p.yellow > 200);
    assert.equal(await canvas.count(), 1);
    await page.waitForTimeout(350); assert.equal(workers.size, initialWorkers);
  }
  await pixels('06-remote-reloaded-project');
  assert.deepEqual(errors, []); assert.deepEqual(outside, []);
  result.remoteReload = true; result.projectAndVideoSwitches = 3;
  console.log(JSON.stringify(result, null, 2));
  writeFileSync(join(artifacts, 'result.json'), JSON.stringify(result, null, 2));
} catch (error) {
  await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true });
  console.error(JSON.stringify({ errors, outside, exports: exports.length, lastExport: exports.at(-1),
    canvases: await canvas.evaluateAll(els => els.map(el => ({ style: el.getAttribute('style'), width: el.width, height: el.height }))) }));
  throw error;
} finally { await context.close(); await browser.close(); }
