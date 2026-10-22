import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cuerelay-timeline-'));
const file = join(dir, 'speech-like.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
  'testsrc2=size=160x90:rate=10:duration=45', '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=45',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '35', '-pix_fmt', 'yuv420p',
  '-af', "volume='if(lt(mod(t,4),2),1,0)':eval=frame,pan=stereo|c0=c0|c1=-1*c0", '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', file]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
const mediaUploads = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => {
  if (request.method() === 'POST' && !request.url().includes('/api/ass/')) mediaUploads.push(request.url());
});
const report = { browser: browser.version(), errors, mediaUploads };
try {
  await page.goto(process.env.AUDIO_TIMELINE_URL || 'http://127.0.0.1:5176/');
  await page.getByRole('button', { name: '导出 ASS', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.file-actions button').disabled);
  await page.getByLabel('导入本地视频').setInputFiles(file);
  const timeline = page.getByRole('region', { name: '音频时间轴' });
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
  const bounds = async () => timeline.evaluate(el => ({ start: Number(el.dataset.start), end: Number(el.dataset.end), decoded: Number(el.dataset.decodedSegments), cache: Number(el.dataset.cacheBytes) }));
  report.initial = await bounds();
  assert.equal(report.initial.end, 10);
  assert.equal(report.initial.decoded, 5);
  assert(report.initial.cache > 0 && report.initial.cache <= 32 * 1024 ** 2);
  // Read pixels to confirm real waveform peaks and silent sections were drawn, without synthetic placeholder data.
  report.wavePixels = await page.locator('.audio-stage canvas').evaluate(canvas => {
    const context = canvas.getContext('2d');
    const ratio = canvas.width / canvas.clientWidth;
    const pixels = context.getImageData(0, Math.round(30 * ratio), canvas.width, canvas.height - Math.round(30 * ratio)).data;
    let ink = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 100 && pixels[i + 1] < 130 && pixels[i + 2] < 110) ink++;
    return ink;
  });
  assert(report.wavePixels > 100);
  await page.screenshot({ path: join(dir, 'waveform.png') });
  report.screenshot = join(dir, 'waveform.png');

  const beforeSpectrum = await bounds();
  await page.getByRole('button', { name: 'Spectrum', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.audio-timeline').dataset.state === 'ready');
  report.spectrum = await bounds();
  assert.equal(report.spectrum.start, beforeSpectrum.start);
  assert.equal(report.spectrum.end, beforeSpectrum.end);
  // Only one edge neighbor may need decoding; all visible waveform PCM is reused.
  assert(report.spectrum.decoded <= beforeSpectrum.decoded + 1);
  await page.screenshot({ path: join(dir, 'spectrum.png') });
  report.spectrumScreenshot = join(dir, 'spectrum.png');
  report.spectrumPixels = await page.locator('.audio-stage canvas').evaluate(canvas => {
    const context = canvas.getContext('2d'); const scale = canvas.width / canvas.clientWidth;
    const height = canvas.height - 22 * scale;
    const row = 22 * scale + height * (1 - (1000 - 80) / (8000 - 80));
    const loud = context.getImageData(Math.round(canvas.width * 0.1), Math.round(row), 1, 1).data;
    const quiet = context.getImageData(Math.round(canvas.width * 0.3), Math.round(row), 1, 1).data;
    return { loud: [...loud], quiet: [...quiet] };
  });
  assert(report.spectrumPixels.loud[0] < report.spectrumPixels.quiet[0] - 50);
  await page.getByRole('button', { name: 'Waveform', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.audio-timeline').dataset.state === 'ready');
  assert.equal((await bounds()).decoded, report.spectrum.decoded);

  await page.getByRole('button', { name: '放大音频时间轴', exact: true }).click();
  assert.equal((await bounds()).end - (await bounds()).start, 5);
  await page.waitForFunction(() => document.querySelector('.audio-timeline').dataset.state === 'ready');
  assert.equal((await bounds()).decoded, report.spectrum.decoded);
  const stage = page.locator('.audio-stage');
  const rect = await stage.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(100);
  const zoomed = await bounds();
  assert(zoomed.end - zoomed.start < 5);
  await page.mouse.move(rect.x + rect.width * 0.7, rect.y + rect.height / 2);
  await page.mouse.down(); await page.mouse.move(rect.x + rect.width * 0.2, rect.y + rect.height / 2, { steps: 8 }); await page.mouse.up();
  assert((await bounds()).start > zoomed.start);
  const beforeClick = await bounds();
  await stage.click({ position: { x: rect.width / 2, y: rect.height / 2 } });
  const expected = (beforeClick.start + beforeClick.end) / 2;
  const sought = await page.locator('video').evaluate(video => video.currentTime);
  assert(Math.abs(sought - expected) < 0.05);
  await page.locator('video').evaluate(async video => { video.currentTime = 20.25; await video.play(); });
  await page.waitForTimeout(180);
  const playing = await bounds();
  assert(playing.start <= 20.25 && playing.end > 20.25);
  assert.equal(await page.locator('.audio-playhead').evaluate(el => el.hidden), false);
  await page.locator('video').evaluate(video => video.pause());
  const paused = await page.locator('video').evaluate(video => video.currentTime);
  await page.waitForTimeout(100);
  assert(Math.abs(await page.locator('video').evaluate(video => video.currentTime) - paused) < 0.02);

  await page.getByLabel('导入基础 ASS').setInputFiles(resolve('../backend/ass_format/fixtures/basic.ass'));
  await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  await page.getByLabel('字幕入点 0:00:01.20', { exact: true }).waitFor();
  await page.getByLabel('字幕出点 0:00:03.40', { exact: true }).waitFor();
  report.selected = await bounds();
  assert(report.selected.start <= 1.2);
  const inputTime = page.getByRole('textbox', { name: '入点', exact: true });
  const startHandle = page.getByRole('slider', { name: /^字幕入点/ });
  await startHandle.focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await inputTime.inputValue(), '0:00:01.21');
  await page.keyboard.press('Shift+ArrowRight');
  assert.equal(await inputTime.inputValue(), '0:00:01.31');
  const dragRect = await stage.boundingBox();
  const handleRect = await startHandle.boundingBox();
  const selectedView = await bounds();
  const targetTime = 1.5;
  const targetX = dragRect.x + (targetTime - selectedView.start) / (selectedView.end - selectedView.start) * dragRect.width;
  await page.mouse.move(handleRect.x + handleRect.width / 2, handleRect.y + handleRect.height / 2);
  await page.mouse.down(); await page.mouse.move(targetX, handleRect.y + handleRect.height / 2, { steps: 8 }); await page.mouse.up();
  assert.equal(await inputTime.inputValue(), '0:00:01.50');
  await startHandle.focus(); await page.keyboard.press('KeyG');
  assert.equal(await page.locator('.cue-list tbody tr').first().locator('.time-cell').first().textContent(), '0:00:01.50');
  report.boundary = { afterDrag: await inputTime.inputValue(), committed: true };

  // Repeated viewport changes while Spectrum is computing must leave the newest request visible.
  await page.evaluate(() => {
    window.__audioPerf = { maxGap: 0, previous: performance.now(), tasks: [] };
    window.__audioPerf.timer = setInterval(() => {
      const now = performance.now();
      window.__audioPerf.maxGap = Math.max(window.__audioPerf.maxGap, now - window.__audioPerf.previous);
      window.__audioPerf.previous = now;
    }, 16);
    window.__audioPerf.observer = new PerformanceObserver(list => window.__audioPerf.tasks.push(...list.getEntries().map(entry => entry.duration)));
    window.__audioPerf.observer.observe({ type: 'longtask', buffered: false });
  });
  await page.getByRole('button', { name: 'Spectrum', exact: true }).click();
  await stage.focus();
  for (let i = 0; i < 30; i++) await page.keyboard.press(i % 3 === 0 ? 'ArrowLeft' : 'ArrowRight');
  const latest = await bounds();
  await page.waitForFunction(() => document.querySelector('.audio-timeline').dataset.state === 'ready');
  assert.equal((await bounds()).start, latest.start);
  report.stress = { ...(await bounds()), ...await page.evaluate(() => {
    clearInterval(window.__audioPerf.timer); window.__audioPerf.observer.disconnect();
    return { maxHeartbeatGapMs: window.__audioPerf.maxGap, longTasksMs: window.__audioPerf.tasks };
  }) };
  assert(report.stress.cache <= 32 * 1024 ** 2);
  assert(report.stress.maxHeartbeatGapMs < 500);
  const countBefore = await page.locator('.cue-list tbody tr').count();
  await page.getByLabel('字幕中文文本').fill('音频回归测试');
  await page.locator('h1').click();
  await page.keyboard.press('KeyG');
  assert.equal(await page.locator('.cue-list tbody tr').count(), countBefore);
  assert.equal(await page.getByLabel('字幕中文文本').inputValue(), '音频回归测试');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 ASS', exact: true }).click();
  assert.equal((await download).suggestedFilename(), 'cuerelay.ass');
  await page.setViewportSize({ width: 800, height: 900 });
  await page.getByRole('button', { name: 'Waveform', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.audio-timeline').dataset.state === 'ready');
  const mobile = await stage.boundingBox();
  assert(mobile.width > 100 && mobile.height >= 64);
  report.narrow = { width: mobile.width, height: mobile.height };
  if (process.env.AUDIO_LARGE_FIXTURE) {
    const largePage = await browser.newPage();
    await largePage.goto(process.env.AUDIO_TIMELINE_URL || 'http://127.0.0.1:5176/');
    await largePage.getByLabel('导入本地视频').setInputFiles(process.env.AUDIO_LARGE_FIXTURE);
    await largePage.waitForFunction(() => document.querySelector('.audio-timeline').dataset.state === 'ready');
    report.largeFile = await largePage.locator('.audio-timeline').evaluate(el => ({ ...el.dataset }));
    assert(Number(report.largeFile.cacheBytes) <= 32 * 1024 ** 2);
    await largePage.getByRole('button', { name: 'Spectrum', exact: true }).click();
    await largePage.waitForFunction(() => document.querySelector('.audio-timeline').dataset.state === 'ready');
    await largePage.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(mediaUploads, []);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error('Audio timeline state:', await page.locator('.audio-timeline').evaluate(el => ({ ...el.dataset, text: el.textContent })).catch(() => null));
  await page.screenshot({ path: join(dir, 'failure.png') }).catch(() => {});
  console.error('Failure screenshot:', join(dir, 'failure.png'));
  throw error;
} finally { await browser.close(); }
