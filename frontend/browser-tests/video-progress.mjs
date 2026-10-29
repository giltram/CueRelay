import { uiDocument } from './ass-codec.mjs';
import { unavailableAssPreview } from './ass-preview-fixture.mjs';
// UI fixtures and a real local MP4; no development accounts or database writes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-video-progress-'));
const file = join(artifacts, 'video.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
  'testsrc2=size=320x180:rate=25:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], unexpected = [];
page.on('pageerror', error => errors.push(String(error)));
try {
  const fixtures = {
    '/api/auth/session': { user: { id: 1, username: 'progress-fixture', is_dev: false } },
    '/api/organizations': { organizations: [] },
    '/api/me/settings': { shortcut_overrides: {}, audio_display_mode: 'spectrum' },
    '/api/ass/empty': { document: uiDocument(['Default']) },
  };
  await page.route('**/api/**', async route => {
    if (await unavailableAssPreview(route)) return;
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && fixtures[path]) await route.fulfill({ json: fixtures[path] });
    else { unexpected.push(`${request.method()} ${path}`); await route.abort(); }
  });
  await page.goto(`${process.env.VIDEO_PROGRESS_URL || 'http://127.0.0.1:5173'}/workspace/local`);
  const slider = page.getByRole('slider', { name: '视频进度', exact: true });
  const video = page.locator('video');
  await slider.waitFor();
  assert(await slider.isDisabled());
  assert.equal(await video.evaluate(el => el.controls), false);
  assert.equal(await page.locator('.time-display').textContent(), '0:00:00.00 / 0:00:00.00');
  await page.getByLabel('导入本地视频').setInputFiles(file);
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
  assert(await slider.isEnabled());
  assert.equal(await page.locator('.time-display').textContent(), '0:00:00.00 / 0:00:12.00');
  await video.evaluate(el => { window.__progressVideo = el; });
  const timeNear = time => page.waitForFunction(time => {
    const video = document.querySelector('video'), slider = document.querySelector('.video-progress');
    return !video.seeking && Math.abs(video.currentTime - time) < .25 && Math.abs(Number(slider.value) / 1000 - video.currentTime) < .3;
  }, time);
  const clickAt = async fraction => {
    const box = await slider.boundingBox();
    await slider.click({ position: { x: box.width * fraction, y: box.height / 2 } });
  };
  await clickAt(.25); await timeNear(3);
  assert(await video.evaluate(el => el.paused));
  assert.match(await page.locator('.time-display').textContent(), /^0:00:0[23]\.\d{2} \/ 0:00:12\.00$/);
  const box = await slider.boundingBox();
  await page.mouse.move(box.x + box.width * .25, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .7, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up(); await timeNear(8.4);
  assert(await video.evaluate(el => el.paused));

  // Native range keyboard input cannot commit a subtitle or start audition playback.
  await slider.focus(); await page.keyboard.press('Home'); await timeNear(0);
  await page.keyboard.press('ArrowRight');
  assert(await video.evaluate(el => el.currentTime > 0));
  await page.keyboard.press('End'); await timeNear(12);
  await page.keyboard.press('Home'); await timeNear(0);
  for (const key of ['KeyG', 'Enter', 'Space']) await page.keyboard.press(key);
  assert.equal(await page.locator('.cue-list tbody tr').count(), 1);
  assert(await video.evaluate(el => el.paused));

  // Scrubbing cancels the independent audition and keeps video paused; ordinary play still advances.
  await page.locator('main').focus(); await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.auditionPhase === 'playing');
  await clickAt(.5); await timeNear(6);
  assert(await video.evaluate(el => el.paused));
  assert.equal(await page.locator('.audio-timeline').getAttribute('data-audition-phase'), 'idle');
  await page.getByRole('button', { name: '播放 / 暂停', exact: true }).click();
  await page.waitForFunction(() => {
    const video = document.querySelector('video');
    return !video.paused && video.currentTime > 6.2;
  });
  await video.evaluate(el => el.pause());
  await clickAt(.25); await timeNear(3);
  await page.waitForFunction(() => {
    const video = document.querySelector('video'), timeline = document.querySelector('.audio-timeline');
    const marker = document.querySelector('.audio-playhead');
    const percent = (video.currentTime - Number(timeline.dataset.start)) / (Number(timeline.dataset.end) - Number(timeline.dataset.start)) * 100;
    return !marker.hidden && Math.abs(parseFloat(marker.style.left) - percent) < .1;
  });

  // External seeks and ordinary playback keep both the clock and slider current.
  await video.evaluate(el => { el.currentTime = 5; }); await timeNear(5);
  assert.equal(await page.locator('.time-display').textContent(), '0:00:05.00 / 0:00:12.00');
  await page.getByRole('button', { name: '播放 / 暂停', exact: true }).click();
  await page.waitForFunction(() => Number(document.querySelector('.video-progress').value) > 5300);
  await page.getByRole('button', { name: '播放 / 暂停', exact: true }).click();
  assert(await video.evaluate(el => el.paused));

  for (const width of [1440, 1000, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    // Read one layout snapshot: ResizeObserver can update pane sizing between
    // separate locator calls immediately after a viewport resize.
    const { frame, progress, transport } = await page.evaluate(() => ({
      frame: document.querySelector('.video-stage').getBoundingClientRect().toJSON(),
      progress: document.querySelector('.video-progress').getBoundingClientRect().toJSON(),
      transport: document.querySelector('.transport').getBoundingClientRect().toJSON(),
    }));
    assert(Math.abs(frame.width / frame.height - 16 / 9) < .01);
    assert(progress.y >= frame.y + frame.height);
    assert(transport.y >= progress.y + progress.height);
    assert(progress.x >= 0 && progress.x + progress.width <= width);
    assert(await video.evaluate(el => el === window.__progressVideo && !el.controls));
    await page.screenshot({ path: join(artifacts, `workspace-${width}.png`) });
  }
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log(JSON.stringify({ browser: browser.version(), artifacts, pointerAndKeyboard: true,
    auditionCanceled: true, playbackAndTimelineSync: true, layouts: [1440, 1000, 390], errors, unexpected }, null, 2));
} finally { await browser.close(); }
