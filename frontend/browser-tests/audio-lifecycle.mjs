import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = mkdtempSync(join(tmpdir(), 'cuerelay-lifecycle-'));
const path = name => join(directory, name);
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10:duration=40', '-f', 'lavfi', '-i',
  'sine=frequency=440:sample_rate=48000:duration=40', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '35',
  '-c:a', 'aac', '-movflags', '+faststart', path('valid.mp4'));
ffmpeg('-i', path('valid.mp4'), '-an', '-c:v', 'copy', path('no-audio.mp4'));
ffmpeg('-i', path('valid.mp4'), '-c:v', 'copy', '-c:a', 'alac', '-t', '4', path('unsupported.mp4'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(15000);
const errors = []; page.on('pageerror', error => errors.push(String(error)));
await page.addInitScript(() => {
  const NativeWorker = window.Worker;
  window.__workerStats = { created: 0, terminated: 0 };
  window.Worker = class extends NativeWorker {
    constructor(...args) { super(...args); window.__workerStats.created++; }
    terminate() { window.__workerStats.terminated++; super.terminate(); }
  };
});
const base = process.env.AUDIO_TIMELINE_URL || 'http://127.0.0.1:5176/';
try {
  await page.goto(new URL('/experiments/audio-lifecycle.html', base).href);
  const input = page.getByLabel('验证文件');
  await input.setInputFiles(path('valid.mp4'));
  for (let i = 0; i < 10; i++) {
    await page.getByRole('button', { name: '换区间', exact: true }).click();
    await input.setInputFiles(path(i % 2 ? 'valid.mp4' : 'no-audio.mp4'));
  }
  await input.setInputFiles(path('no-audio.mp4'));
  await page.waitForFunction(() => document.querySelector('output').dataset.state === 'error');
  assert((await page.locator('output').textContent()).includes('没有音轨'));
  await page.waitForTimeout(150);
  assert.equal(await page.locator('output').getAttribute('data-tiles'), '0');
  await input.setInputFiles(path('unsupported.mp4'));
  await page.waitForFunction(() => document.querySelector('output').dataset.state === 'error');
  assert((await page.locator('output').textContent()).includes('WebCodecs'));
  await input.setInputFiles(path('valid.mp4'));
  await page.waitForFunction(() => document.querySelector('output').dataset.state === 'ready');
  await page.getByRole('button', { name: '装卸组件', exact: true }).click();
  const unmounted = await page.evaluate(() => window.__workerStats);
  assert.equal(unmounted.created, unmounted.terminated);
  await page.getByRole('button', { name: '装卸组件', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('output').dataset.state === 'ready');
  await page.getByRole('button', { name: '清除文件', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('output').dataset.state === 'empty');
  const cleared = await page.evaluate(() => window.__workerStats);
  assert.equal(cleared.created, cleared.terminated);
  assert.deepEqual(errors, []);

  // Actual fixed-file editor: a missing audio track must leave video and subtitle editing usable.
  await page.goto(base);
  await page.waitForFunction(() => !document.querySelector('.file-actions button.primary').disabled);
  await page.getByLabel('导入本地视频').setInputFiles(path('no-audio.mp4'));
  await page.waitForFunction(() => document.querySelector('.audio-timeline').dataset.state === 'error');
  assert((await page.locator('.audio-message').textContent()).includes('没有音轨'));
  await page.locator('video').evaluate(async video => { video.currentTime = 5; await video.play(); });
  assert.equal(await page.locator('video').evaluate(video => video.paused), false);
  await page.locator('video').evaluate(video => video.pause());
  await page.getByRole('textbox', { name: '入点', exact: true }).fill('0:00:01.00');
  await page.getByRole('textbox', { name: '出点', exact: true }).fill('0:00:02.00');
  await page.getByRole('button', { name: '创建新行 [N]', exact: true }).click();
  assert.equal(await page.locator('.cue-list tbody tr').count(), 1);
  console.log(JSON.stringify({ browser: browser.version(), unmounted, cleared, noAudioVideoAndEditing: true, errors }, null, 2));
} finally { await browser.close(); }
