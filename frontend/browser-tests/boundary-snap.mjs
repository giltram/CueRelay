// Real Chrome pointer capture, drafts and history, with isolated HTTP fixtures.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { uiDocument } from './ass-codec.mjs';
import { unavailableAssPreview } from './ass-preview-fixture.mjs';

const dir = mkdtempSync(join(tmpdir(), 'cuerelay-boundary-snap-'));
const file = join(dir, 'tone.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=20',
  '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=20', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
const empty = uiDocument(); empty.cues = [];
const document = { ...empty, cues: [[1000, 2000], [3000, 5000], [6000, 7000]].map(([start_ms, end_ms]) =>
  ({ id: randomUUID(), start_ms, end_ms, style_id: empty.styles[0].id, text: '' })) };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [], unexpected = [];
page.on('pageerror', error => errors.push(String(error)));
await page.route('**/api/**', async route => {
  if (await unavailableAssPreview(route)) return;
  const path = new URL(route.request().url()).pathname;
  const fixtures = {
    '/api/auth/session': { user: { id: 1, username: 'snap', is_dev: false } },
    '/api/organizations': { organizations: [] },
    '/api/me/settings': { handbook_seen: true, audio_display_mode: 'spectrum', shortcut_overrides: {}, mouse_sets_cue_boundary: true },
    '/api/ass/empty': { document: empty },
    '/api/ass/import': { document },
  };
  if (fixtures[path]) return route.fulfill({ json: fixtures[path] });
  unexpected.push(`${route.request().method()} ${path}`); await route.abort();
});
const stage = page.locator('.audio-stage');
const start = page.getByRole('textbox', { name: '入点', exact: true });
const end = page.getByRole('textbox', { name: '出点', exact: true });
const main = page.locator('main.editor-workbench');
const readView = () => page.locator('.audio-timeline').evaluate(el => ({ start: Number(el.dataset.start), span: Number(el.dataset.end) - Number(el.dataset.start) }));
const reset = async () => { await start.fill('0:00:03.00'); await end.fill('0:00:05.00'); };
async function clickNear(time, offset, button = 'left', shift = false) {
  const box = await stage.boundingBox(), view = await readView();
  await stage.click({ button, modifiers: shift ? ['Shift'] : [], position: {
    x: (time - view.start) / view.span * box.width + offset, y: box.height * .65,
  } });
}
async function dragNear(point, time, offset, shift = false) {
  const slider = page.getByRole('slider', { name: point === 'start' ? /^字幕入点/ : /^字幕出点/ });
  const handle = await slider.boundingBox(), box = await stage.boundingBox(), view = await readView();
  const button = point === 'end' ? 'right' : 'left';
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down({ button });
  await page.mouse.move(box.x + (time - view.start) / view.span * box.width + offset, handle.y + handle.height / 2, { steps: 6 });
  await page.mouse.up({ button });
  if (shift) await page.keyboard.up('Shift');
}
try {
  await page.goto(process.env.BOUNDARY_SNAP_URL || 'http://127.0.0.1:5173/workspace/local');
  await page.getByLabel('导入本地视频').setInputFiles(file);
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
  await page.getByLabel('导入基础 ASS').setInputFiles({ name: 'snap.ass', mimeType: 'text/plain', buffer: Buffer.from('fixture') });
  await page.getByRole('button', { name: '选择第 2 行', exact: true }).click();
  await page.locator('video').evaluate(video => { video.currentTime = 4.5; });
  await page.waitForFunction(() => document.querySelector('video').currentTime === 4.5);
  const view = await readView();
  for (const shift of [false, true]) {
    await reset();
    await clickNear(2, 6, 'left', shift);
    assert.equal((await start.inputValue()) === '0:00:02.00', !shift);
    await clickNear(6, -6, 'right', shift);
    assert.equal((await end.inputValue()) === '0:00:06.00', !shift);
  }
  await reset(); await clickNear(2, 12);
  assert.notEqual(await start.inputValue(), '0:00:02.00');
  assert.deepEqual(await readView(), view);
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 4.5);
  assert.deepEqual(await page.locator('.cue-list tbody tr').nth(1).locator('.time-cell').allTextContents(), ['0:00:03.00', '0:00:05.00']);

  for (const point of ['start', 'end']) {
    const input = point === 'start' ? start : end;
    const target = point === 'start' ? 2 : 6;
    for (const shift of [false, true]) {
      await reset(); await dragNear(point, target, 6, shift);
      assert.equal((await input.inputValue()) === `0:00:0${target}.00`, !shift);
    }
  }
  await reset(); await dragNear('end', 6, -6);
  await main.focus(); await page.keyboard.press('Control+z');
  assert.equal(await end.inputValue(), '0:00:05.00');
  await page.keyboard.press('Control+Shift+z'); assert.equal(await end.inputValue(), '0:00:06.00');
  await page.getByRole('slider', { name: /^字幕出点/ }).focus();
  await page.keyboard.press('ArrowLeft'); assert.equal(await end.inputValue(), '0:00:05.99');
  await page.keyboard.press('Shift+ArrowLeft'); assert.equal(await end.inputValue(), '0:00:05.89');

  await reset(); await clickNear(5, -6);
  assert.equal(await start.inputValue(), '0:00:05.00'); // Opposite draft remains a target.
  await reset(); await clickNear(4.5, 6, 'right');
  assert.equal(await end.inputValue(), '0:00:04.50'); // Displayed playhead uses live media time.

  // A fixed pixel radius works at a different zoom and pan, too.
  await reset();
  await stage.dispatchEvent('wheel', { deltaY: -Math.log(2) / .004, deltaX: 0, deltaMode: 0, shiftKey: true, clientX: 0 });
  await stage.dispatchEvent('wheel', { deltaY: 50, deltaX: 0, deltaMode: 0 });
  assert((await readView()).span < view.span);
  assert((await readView()).start > 0);
  await clickNear(2, 6); assert.equal(await start.inputValue(), '0:00:02.00');
  await reset(); await clickNear(2, 12); assert.notEqual(await start.inputValue(), '0:00:02.00');
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log(JSON.stringify({ browser: browser.version(), clicks: true, drags: true, shift: true, history: true,
    keyboard: true, oppositeBoundary: true, playhead: true, zoomAndPan: true, errors, unexpected }));
} catch (error) {
  console.error(JSON.stringify({ errors, unexpected, body: await page.locator('body').innerText() }));
  throw error;
} finally { await browser.close(); }
