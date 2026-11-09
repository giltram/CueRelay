import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uiDocument } from './ass-codec.mjs';
import { unavailableAssPreview } from './ass-preview-fixture.mjs';
import { observeTimelineReuse, checkTimelineReuse } from './timeline-reuse-checks.mjs';

const directory = mkdtempSync(join(tmpdir(), 'cuerelay-audio-reuse-'));
const file = join(directory, 'audio.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=40',
  '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=40', '-c:v', 'libx264', '-preset', 'ultrafast',
  '-c:a', 'aac', '-movflags', '+faststart', file]);
const documentFixture = uiDocument();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(10000);
const errors = [], unexpected = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('dialog', dialog => dialog.accept());
let mode = 'spectrum';
await page.route('**/api/**', async route => {
  if (await unavailableAssPreview(route)) return;
  const path = new URL(route.request().url()).pathname;
  const fixtures = {
    '/api/auth/session': { user: { id: 1, username: 'reuse', is_dev: false } },
    '/api/organizations': { organizations: [] },
    '/api/me/settings': { handbook_seen: true, shortcut_overrides: {}, audio_display_mode: mode },
    '/api/ass/empty': { document: documentFixture },
  };
  if (fixtures[path]) return route.fulfill({ json: fixtures[path] });
  unexpected.push(path); return route.abort();
});
try {
  await observeTimelineReuse(page);
  await page.goto(`${process.env.AUDIO_REUSE_URL || 'http://127.0.0.1:5173'}/workspace/local`);
  await page.getByLabel('导入本地视频').setInputFiles(file);
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
  const reuse = await checkTimelineReuse(page);
  const decoded = await page.locator('.audio-timeline').getAttribute('data-decoded-segments');
  for (const next of ['waveform', 'spectrum']) {
    mode = next;
    await page.evaluate(() => dispatchEvent(new Event('focus')));
    await page.waitForFunction(mode => document.querySelector('.audio-timeline')?.dataset.mode === mode
      && document.querySelector('.audio-timeline').dataset.state === 'ready', mode);
    assert.equal(await page.locator('.audio-timeline').getAttribute('data-decoded-segments'), decoded);
  }
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log(JSON.stringify({ ...reuse, modeReuse: true, errors, unexpected }));
} finally { await browser.close(); }
