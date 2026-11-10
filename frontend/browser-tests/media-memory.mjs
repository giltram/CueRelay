// Bounded real-media observation. RSS sums include shared pages; they are not GPU allocation accounting.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { codec } from './ass-codec.mjs';
import { installPerformanceFixtures } from './performance-fixtures.mjs';
import { sameTab } from './link-navigation.mjs';

assert(process.env.MEDIA_FILE && process.env.MEDIA_ASS, 'Set MEDIA_FILE and MEDIA_ASS to local files');
const file = resolve(process.env.MEDIA_FILE), subtitle = resolve(process.env.MEDIA_ASS);
const origin = process.env.PERF_URL || 'http://127.0.0.1:5280';
const cycles = Number(process.env.MEDIA_CYCLES || 8);
const releaseSeconds = Number(process.env.MEDIA_RELEASE_SECONDS || 30);
assert(Number.isInteger(cycles) && cycles > 0 && releaseSeconds >= 1);
const directory = mkdtempSync(join(tmpdir(), 'cuerelay-media-memory-'));
const output = resolve(process.env.MEDIA_OUTPUT || join(directory, 'results.json'));
const parsed = codec('parse', { source: readFileSync(subtitle, 'utf8') });
assert.equal(parsed.status, 200, JSON.stringify(parsed));
const document = parsed.body.document;
const specification = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries',
  'format=duration,size:stream=codec_type,codec_name,width,height,sample_rate,channels', '-of', 'json', file], { encoding: 'utf8' }));
const duration = Number(specification.format.duration);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const browserCdp = await browser.newBrowserCDPSession();
const report = { environment: { browser: browser.version(), platform: process.platform, cycles, releaseSeconds,
  origin, mediaBytes: statSync(file).size, specification, cues: document.cues.length }, samples: [], cycles: [], errors: [] };
const start = Date.now();
let phase = 'baseline', pendingSample = null;
const save = () => writeFileSync(output, JSON.stringify(report, null, 2));
function sample() {
  if (pendingSample) return pendingSample;
  pendingSample = (async () => {
    const processes = (await browserCdp.send('SystemInfo.getProcessInfo')).processInfo;
    const rss = new Map(execFileSync('ps', ['-axo', 'pid=,rss='], { encoding: 'utf8' }).trim().split('\n')
      .map(line => line.trim().split(/\s+/).map(Number)));
    const byType = {};
    for (const process of processes) byType[process.type] = (byType[process.type] || 0) + (rss.get(process.id) || 0) * 1024;
    report.samples.push({ seconds: (Date.now() - start) / 1000, phase, rssBytes: Object.values(byType).reduce((a, b) => a + b, 0), byType });
  })().finally(() => { pendingSample = null; });
  return pendingSample;
}
function observeLifecycle() {
  const stats = window.__mediaLife = { created: 0, terminated: 0, contexts: 0, closed: 0 };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) { super(...args); stats.created++; }
    terminate() { if (!this.__terminated) { this.__terminated = true; stats.terminated++; } super.terminate(); }
  };
  const NativeContext = window.AudioContext;
  window.AudioContext = class extends NativeContext {
    constructor(...args) { super(...args); stats.contexts++; }
    // Count close requests, not native decoder/device memory release.
    close() { if (!this.__closed) { this.__closed = true; stats.closed++; } return super.close(); }
  };
}
const timer = setInterval(() => { void sample().catch(error => report.errors.push(String(error))); }, 1000);
console.log(`results: ${output}`);
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await installPerformanceFixtures(context, document, report.errors);
  await context.addInitScript(observeLifecycle);
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => report.errors.push(String(error)));
  page.on('dialog', dialog => dialog.accept());
  const cdp = await context.newCDPSession(page);
  await page.goto('about:blank'); await sample();
  for (let cycle = 0; cycle < cycles; cycle++) {
    phase = `load-${cycle}`;
    await page.goto(`${origin}/workspace/local`);
    await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
    await page.getByLabel('导入本地视频').setInputFiles(file);
    await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready'
      && document.querySelector('.ass-preview-status')?.dataset.phase === 'ready');
    phase = `operate-${cycle}`;
    const video = page.locator('video');
    const target = Math.min(duration - 10, (cycle * 137 + 10) % duration);
    await video.evaluate((video, target) => { video.currentTime = target; }, target);
    await page.waitForFunction(target => !document.querySelector('video').seeking && Math.abs(document.querySelector('video').currentTime - target) < .1, target);
    await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
    await video.evaluate(async video => { video.muted = true; await video.play(); });
    await page.waitForTimeout(2000); await video.evaluate(video => video.pause());
    await page.locator('main.editor-workbench').focus(); await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.auditionPhase === 'finished');
    await sameTab(page.getByRole('link', { name: '项目列表', exact: true }));
    await page.locator('main.editor-workbench').waitFor({ state: 'hidden' });
    await page.waitForTimeout(1000);
    await page.goBack(); await page.locator('main.editor-workbench').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: '显示字幕', exact: true }).click();
    await page.locator('.ass-preview-canvas').waitFor({ state: 'detached' });
    await page.waitForFunction(() => window.__mediaLife.created - window.__mediaLife.terminated === 1);
    const resources = await page.evaluate(() => ({ ...window.__mediaLife,
      cacheBytes: Number(document.querySelector('.audio-timeline').dataset.cacheBytes) }));
    assert.equal(resources.contexts, resources.closed);
    assert(resources.cacheBytes <= 32 * 1024 * 1024);
    await sample();
    phase = `released-${cycle}`;
    await page.goto('about:blank');
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(5000); await sample();
    const heap = await cdp.send('Runtime.getHeapUsage');
    report.cycles.push({ cycle, target, resources, heap, releasedSample: report.samples.at(-1) });
    assert.deepEqual(report.errors, []); save();
    console.log(JSON.stringify({ cycle, resources, rssMiB: report.samples.at(-1).rssBytes / 1024 / 1024 }));
  }
  // Use the existing development-only entry for replacements and a React unmount.
  if (process.env.MEDIA_DEV_URL) {
    phase = 'replacement-probe';
    await page.goto(`${process.env.MEDIA_DEV_URL}/experiments/audio-lifecycle.html`);
    const input = page.getByLabel('验证文件');
    for (let cycle = 0; cycle < cycles; cycle++) {
      // Clear only the native picker value, so choosing the same path emits change again
      // while the previous File remains active in React until its replacement arrives.
      await input.evaluate(element => { element.value = ''; });
      await input.setInputFiles(file);
      await page.waitForFunction(created => document.querySelector('output')?.dataset.state === 'ready'
        && window.__mediaLife.created === created && window.__mediaLife.terminated === created - 1, cycle + 1);
      await page.getByRole('button', { name: '换区间', exact: true }).click();
      console.log(`replacement ${cycle + 1}/${cycles}`);
    }
    await page.getByRole('button', { name: '装卸组件', exact: true }).click();
    await page.waitForFunction(() => window.__mediaLife.created === window.__mediaLife.terminated);
    report.replacements = await page.evaluate(() => window.__mediaLife);
    assert.equal(report.replacements.created, cycles);
    await page.goto('about:blank');
  }
  phase = 'final-release';
  await context.close();
  // Observe natural process release; no assertion that RSS must fall to its startup value.
  await new Promise(resolve => setTimeout(resolve, releaseSeconds * 1000));
  await sample(); assert.deepEqual(report.errors, []);
  report.elapsedSeconds = (Date.now() - start) / 1000;
} catch (error) {
  report.failure = String(error); process.exitCode = 1; console.error(error);
} finally {
  clearInterval(timer);
  await pendingSample?.catch(error => report.errors.push(String(error)));
  save();
  await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 3000).unref())]);
  process.exit(process.exitCode || 0);
}
