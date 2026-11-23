// Same production app, fixtures and Chrome configuration for baseline/updated builds.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus, totalmem, release } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { referenceFixture, referenceMedia, installReferenceFixture, openReference, settle, currentVisible } from './reference-scroll-fixtures.mjs';
const directory = mkdtempSync(join(tmpdir(), 'cuerelay-reference-perf-'));
const output = resolve(process.env.REFERENCE_PERF_OUTPUT || join(directory, 'results.json'));
const origins = (process.env.REFERENCE_PERF_URLS || 'baseline=http://127.0.0.1:5281,updated=http://127.0.0.1:5282').split(',').map(value => value.split('='));
const counts = (process.env.REFERENCE_PERF_COUNTS || '500,5000').split(',').map(Number);
const rounds = Number(process.env.REFERENCE_PERF_ROUNDS || 3);
assert(Number.isInteger(rounds) && rounds > 0);
assert(counts.every(count => Number.isInteger(count) && count > 0 && count <= 5000));
const media = referenceMedia(directory);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] });
const report = { environment: { browser: browser.version(), node: process.version, cpu: cpus()[0]?.model, os: release(), ram: totalmem(),
  viewport: [1440, 900], dpr: 1, cpuRate: 1, rounds, media: media.media, build: 'vite production / preview',
  preview: 'formal ASS preview disabled equally; actual media and audio analysis enabled', chromeArgs: ['--autoplay-policy=no-user-gesture-required', '--disable-audio-output'], memory: 'not reported: no reliable whole-process attribution' }, fixtures: [], runs: [], errors: [] };
const save = () => writeFileSync(output, JSON.stringify(report, null, 2));
const summary = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] ?? 0, min: sorted[0] ?? 0, max: sorted.at(-1) ?? 0 };
};
function observe() {
  const data = window.__referencePerf = { frames: [], tasks: [], running: false, last: 0, maxMounted: 0 };
  new PerformanceObserver(list => data.tasks.push(...list.getEntries().map(e => ({ at: e.startTime, ms: e.duration })))).observe({ type: 'longtask', buffered: true });
  const frame = now => { if (data.running) { if (data.last) data.frames.push(now - data.last); data.maxMounted = Math.max(data.maxMounted, document.querySelectorAll('.reference-content p').length); } data.last = now; requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
}
const metrics = async cdp => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
async function stage(page, cdp, action) {
  const before = await metrics(cdp);
  const at = await page.evaluate(() => { const d = window.__referencePerf; d.frames = []; d.last = 0; d.maxMounted = 0; d.running = true; return performance.now(); });
  const latencyMs = await action();
  await settle(page);
  const after = await metrics(cdp);
  const detail = await page.evaluate(at => {
    const d = window.__referencePerf; d.running = false;
    return { elapsedMs: performance.now() - at, frames: d.frames, tasks: d.tasks.filter(t => t.at >= at).map(t => t.ms),
      maxMounted: d.maxMounted, mounted: document.querySelectorAll('.reference-content p').length };
  }, at);
  return { latencyMs: typeof latencyMs === 'number' ? latencyMs : null, elapsedMs: detail.elapsedMs, mounted: detail.mounted, maxMounted: detail.maxMounted,
    taskMs: (after.TaskDuration - before.TaskDuration) * 1000, scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
    layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000, layouts: after.LayoutCount - before.LayoutCount,
    longTasks: { ...summary(detail.tasks), total: detail.tasks.reduce((a, b) => a + b, 0) },
    frameMs: summary(detail.frames), framesOver25ms: detail.frames.filter(ms => ms > 25).length };
}
// Browser clock from click to two paints after a current target is in the viewport.
const locate = (page, selector) => page.evaluate(async selector => {
  const started = performance.now(); document.querySelector(selector).click();
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const container = document.querySelector('.reference-content'), box = container?.getBoundingClientRect();
    const row = container?.querySelector('[data-reference-current], [data-reference-unmatched]'), rect = row?.getBoundingClientRect();
    if (rect && rect.top >= box.top - 1 && rect.top < box.bottom) {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return performance.now() - started;
    }
  }
  throw new Error('Reference target failed to appear');
}, selector);
console.log(`results: ${output}`);
try {
  for (const count of counts) {
    const fixture = referenceFixture(count); report.fixtures.push(fixture.metadata);
    // Alternate baseline/updated order by round to reduce fixed-order warm-up bias.
    for (let round = 0; round < rounds; round++) for (const [label, origin] of round % 2 ? [...origins].reverse() : origins) {
      const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      const unexpected = [];
      try {
        await installReferenceFixture(context, fixture.cues, media.media, unexpected); await context.addInitScript(observe);
        const page = await context.newPage(); page.setDefaultTimeout(15000);
        page.on('pageerror', e => report.errors.push(String(e)));
        const cdp = await context.newCDPSession(page); await cdp.send('Performance.enable');
        await openReference(page, origin, media.file); await page.waitForTimeout(400);
        const bundle = await page.locator('script[type="module"][src]').getAttribute('src');
        const response = await context.request.get(new URL(bundle, origin).href);
        const run = { label, origin, count, round, bundle: { path: bundle, sha256: createHash('sha256').update(await response.body()).digest('hex') } };
        report.runs.push(run);
        // Collapse first, so expand includes fresh mount/measurement with data already loaded.
        await page.locator('[data-reference-toggle]').click(); await settle(page);
        run.expand = await stage(page, cdp, () => locate(page, '[data-reference-toggle]'));
        run.far = await stage(page, cdp, () => locate(page, 'button[aria-label="选择第 51 行"]'));
        assert(await currentVisible(page));
        run.scroll = await stage(page, cdp, () => page.locator('.reference-content').evaluate(async container => {
          for (let step = 0; step < 90; step++) {
            container.scrollTop += (step < 45 ? 1 : -1) * 80;
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          }
        }));
        // Return to first cue then play the real clock through frequent overlap/gap transitions.
        await page.getByRole('button', { name: '选择第 1 行', exact: true }).evaluate(node => node.click()); await settle(page);
        run.play = await stage(page, cdp, async () => {
          await page.locator('video').evaluate(async video => { video.currentTime = 0; video.muted = true; await video.play(); });
          await page.waitForTimeout(3000); await page.locator('video').evaluate(video => video.pause());
        });
        await page.locator('[data-reference-toggle]').click(); await settle(page);
        run.collapsedPlay = await stage(page, cdp, async () => {
          await page.locator('video').evaluate(async video => { video.currentTime = 0; await video.play(); });
          await page.waitForTimeout(3000); await page.locator('video').evaluate(video => video.pause());
        });
        assert.deepEqual(unexpected, []); save(); console.log(JSON.stringify({ label, count, round, expand: run.expand.latencyMs, far: run.far.latencyMs, mounted: run.far.mounted, playTaskMs: run.play.taskMs }));
      } finally { await context.close(); }
    }
  }
  assert.deepEqual(report.errors, []);
} catch (error) { report.failure = String(error); process.exitCode = 1; console.error(error); }
finally {
  save();
  await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 3000).unref())]);
  process.exit(process.exitCode || 0);
}
