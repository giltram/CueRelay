import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { checkRuler, observeRuler } from './ruler-checks.mjs';
import { checkPlayhead } from './playhead-checks.mjs';
import { checkBoundaryClicks } from './boundary-click-checks.mjs';
import { checkCommitTiming } from './commit-timing-checks.mjs';
import { checkShortcutFocus } from './shortcut-focus-checks.mjs';

const dir = mkdtempSync(join(tmpdir(), 'cuerelay-timeline-'));
const file = join(dir, 'tones-and-silence.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
  'testsrc2=size=160x90:rate=10:duration=45', '-f', 'lavfi', '-i',
  'aevalsrc=0.125*sin(2*PI*1000*t)+0.06*sin(2*PI*3000*t)+0.03*sin(2*PI*12000*t):s=48000:d=45',
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
  await observeRuler(page);
  await page.goto(process.env.AUDIO_TIMELINE_URL || 'http://127.0.0.1:5176/');
  await page.getByRole('button', { name: '导出 ASS', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.file-actions button.primary').disabled);
  report.commitTiming = await checkCommitTiming(browser, page.url(), file);
  report.shortcutFocus = await checkShortcutFocus(browser, page.url(), file);
  assert.equal(await page.getByRole('button', { name: 'Spectrum', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.app-header .audio-mode-switch').count(), 1);
  assert.equal(await page.locator('.audio-toolbar').count(), 0);
  await page.getByLabel('导入本地视频').setInputFiles(file);
  const timeline = page.getByRole('region', { name: '音频时间轴' });
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
  const bounds = async () => timeline.evaluate(el => ({ start: Number(el.dataset.start), end: Number(el.dataset.end), decoded: Number(el.dataset.decodedSegments), cache: Number(el.dataset.cacheBytes) }));
  report.initial = await bounds();
  assert.equal(report.initial.end, 10);
  assert.equal(report.initial.decoded, 6); // Default Spectrum includes one STFT edge neighbor.
  assert.equal(await timeline.getAttribute('data-mode'), 'spectrum');
  const panelRect = await timeline.boundingBox();
  const canvasRect = await page.locator('.audio-stage').boundingBox();
  assert(canvasRect.y - panelRect.y <= 2); // Removed toolbar height now belongs to the canvas.
  assert(report.initial.cache > 0 && report.initial.cache <= 32 * 1024 ** 2);
  report.newCueClickTiming = await checkBoundaryClicks(page);
  await page.getByRole('button', { name: 'Waveform', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.audio-timeline').dataset.state === 'ready');
  // Read pixels to confirm real waveform peaks and silent sections were drawn, without synthetic placeholder data.
  report.wavePixels = await page.locator('.audio-stage canvas').evaluate(canvas => {
    const context = canvas.getContext('2d');
    const ratio = canvas.width / canvas.clientWidth;
    const pixels = context.getImageData(0, Math.round(30 * ratio), canvas.width, canvas.height - Math.round(30 * ratio)).data;
    let ink = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 50 && pixels[i + 1] > 150 && pixels[i + 2] > 180) ink++;
    return ink;
  });
  assert(report.wavePixels > 100);
  await page.screenshot({ path: join(dir, 'waveform.png') });
  report.screenshot = join(dir, 'waveform.png');
  report.waveformStageScreenshot = join(dir, 'waveform-stage.png');
  await page.locator('.audio-stage').screenshot({ path: report.waveformStageScreenshot });

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
  report.spectrumStageScreenshot = join(dir, 'spectrum-stage.png');
  await page.locator('.audio-stage').screenshot({ path: report.spectrumStageScreenshot });
  report.spectrumPixels = await page.locator('.audio-stage canvas').evaluate(canvas => {
    const context = canvas.getContext('2d');
    const top = 22 * canvas.height / canvas.getBoundingClientRect().height;
    const height = canvas.height - top;
    const sample = (position, frequency) => {
      const row = Math.round(top + height * (1 - frequency / 24000));
      const pixels = context.getImageData(Math.round(canvas.width * position), row - 1, 1, 3).data;
      const colors = Array.from({ length: 3 }, (_, i) => [...pixels.slice(i * 4, i * 4 + 4)]);
      return colors.sort((a, b) => b[0] + b[1] + b[2] - a[0] - a[1] - a[2])[0];
    };
    return { loud: sample(0.1, 1000), quiet: sample(0.3, 1000),
      tones: [1000, 3000, 12000].map(hz => ({ hz, color: sample(0.1, hz) })), upperSilence: sample(0.3, 20000), selectedSilence: sample(0.1, 20000) };
  });
  assert(report.spectrumPixels.loud[1] > report.spectrumPixels.quiet[1] + 100);
  assert.deepEqual(report.spectrumPixels.quiet, [8, 8, 12, 255]);
  assert.deepEqual(report.spectrumPixels.upperSilence, [8, 8, 12, 255]);
  assert.deepEqual(report.spectrumPixels.selectedSilence, [64, 32, 96, 255]);
  for (const tone of report.spectrumPixels.tones) assert(tone.color[2] > 100);
  await page.getByRole('button', { name: 'Waveform', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.audio-timeline').dataset.state === 'ready');
  assert.equal((await bounds()).decoded, report.spectrum.decoded);

  const stage = page.locator('.audio-stage');
  const rect = await stage.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, -Math.log(2) / 0.004);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(100);
  const firstZoom = await bounds();
  assert(Math.abs(firstZoom.end - firstZoom.start - 5) < 0.01);
  await page.waitForFunction(() => document.querySelector('.audio-timeline').dataset.state === 'ready');
  assert.equal((await bounds()).decoded, report.spectrum.decoded);
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(100);
  const panned = await bounds();
  assert(panned.start > firstZoom.start);
  assert(Math.abs((panned.end - panned.start) - (firstZoom.end - firstZoom.start)) < 0.001);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(100);
  const zoomed = await bounds();
  assert(zoomed.end - zoomed.start < panned.end - panned.start);
  report.wheel = { firstZoom, panned, zoomed };
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
  report.playheadDrag = await checkPlayhead(page, bounds);

  await page.getByLabel('导入基础 ASS').setInputFiles(resolve('../backend/ass_format/fixtures/basic.ass'));
  await page.getByRole('button', { name: '替换当前字幕', exact: true }).click();
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
  await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  report.boundary = { afterDrag: await inputTime.inputValue(), committed: true };
  await page.locator('video').evaluate(video => { video.currentTime = 1.5; });
  await page.waitForFunction(() => {
    const boundary = document.querySelector('.audio-boundary.start')?.getBoundingClientRect();
    const playhead = document.querySelector('.audio-playhead')?.getBoundingClientRect();
    return boundary && playhead && Math.abs(boundary.x - playhead.x) < 1;
  });
  report.boundaryWinsOverPlayhead = await startHandle.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return !!document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('.audio-boundary');
  });
  assert(report.boundaryWinsOverPlayhead);
  report.overlayColors = await page.evaluate(() => ({
    stage: getComputedStyle(document.querySelector('.audio-stage')).backgroundColor,
    playhead: getComputedStyle(document.querySelector('.audio-playhead'), '::after').backgroundColor,
    start: getComputedStyle(document.querySelector('.audio-boundary.start'), '::after').backgroundColor,
    end: getComputedStyle(document.querySelector('.audio-boundary.end'), '::after').backgroundColor,
  }));
  assert.equal(report.overlayColors.stage, 'rgb(8, 8, 12)');
  assert.equal(report.overlayColors.start, 'rgb(255, 184, 107)');
  assert.equal(report.overlayColors.end, 'rgb(222, 140, 255)');
  report.selectedCueClickTiming = await checkBoundaryClicks(page, true);
  report.ruler = await checkRuler(page, dir);

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
  await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  await page.getByLabel('字幕中文文本').fill('音频回归测试');
  await page.locator('h1').click();
  await page.keyboard.press('KeyG');
  assert.equal(await page.locator('.cue-list tbody tr').count(), countBefore);
  assert.equal(await page.locator('.cue-list tbody tr').first().locator('.cue-text').textContent(), '音频回归测试');
  assert.equal(await page.getByRole('button', { name: '选择第 2 行', exact: true }).getAttribute('aria-pressed'), 'true');
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
