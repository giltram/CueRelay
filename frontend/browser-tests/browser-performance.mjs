// Production measurement, not a timing-sensitive pass/fail test. See README.md.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir, cpus, totalmem, release } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { performanceDocument, performanceVideo, installPerformanceFixtures } from './performance-fixtures.mjs';

const origin = process.env.PERF_URL || 'http://127.0.0.1:5280';
const rounds = Number(process.env.PERF_ROUNDS || 3);
const counts = (process.env.PERF_COUNTS || '100,199,200,201,500,2000').split(',').map(Number);
const rates = (process.env.PERF_RATES || '1,4').split(',').map(Number);
assert(Number.isInteger(rounds) && rounds > 0);
assert(counts.every(n => Number.isInteger(n) && n > 2) && rates.every(rate => rate >= 1));
const directory = mkdtempSync(join(tmpdir(), 'cuerelay-performance-'));
const output = resolve(process.env.PERF_OUTPUT || join(directory, 'results.json'));
const media = performanceVideo(directory);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const report = { environment: { browser: browser.version(), node: process.version, cpu: cpus()[0]?.model,
  ram: totalmem(), os: release(), origin, rounds, counts, rates, viewport: [1440, 900], dpr: 1 }, runs: [], errors: [], readingFailures: [] };
const save = () => writeFileSync(output, JSON.stringify(report, null, 2));
const summarize = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { n: sorted.length, p50: sorted[Math.floor(sorted.length * .5)] ?? 0,
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] ?? 0,
    max: sorted.at(-1) ?? 0, total: sorted.reduce((a, b) => a + b, 0) };
};

function observe() {
  const data = window.__performanceSample = { inputs: [], tasks: [], rowReads: 0, rowReadMs: 0 };
  new PerformanceObserver(list => data.tasks.push(...list.getEntries().map(entry => ({ at: entry.startTime, ms: entry.duration }))))
    .observe({ type: 'longtask', buffered: true });
  document.addEventListener('input', event => {
    if (!event.target.matches('textarea, .cue-search-bar input')) return;
    const at = performance.now();
    requestAnimationFrame(() => requestAnimationFrame(() => data.inputs.push({ at, ms: performance.now() - at })));
  }, true);
  const rect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (...args) {
    if (!(this instanceof HTMLTableRowElement) || !this.dataset.cueId) return rect.apply(this, args);
    const at = performance.now(), result = rect.apply(this, args);
    data.rowReads++; data.rowReadMs += performance.now() - at;
    return result;
  };
}
async function metrics(cdp) {
  return Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
}
async function stage(page, cdp, action) {
  const before = await metrics(cdp);
  const start = await page.evaluate(() => ({ at: performance.now(), reads: window.__performanceSample.rowReads, readMs: window.__performanceSample.rowReadMs }));
  await action();
  await page.waitForTimeout(100); // Let RAF and PerformanceObserver deliver, equally for every sample.
  const end = await metrics(cdp);
  const detail = await page.evaluate(start => {
    const data = window.__performanceSample;
    return { elapsedMs: performance.now() - start.at, rowReads: data.rowReads - start.reads,
      rowReadMs: data.rowReadMs - start.readMs, inputs: data.inputs.filter(item => item.at >= start.at),
      tasks: data.tasks.filter(item => item.at >= start.at) };
  }, start);
  return { elapsedMs: detail.elapsedMs, inputToTwoRaf: summarize(detail.inputs.map(item => item.ms)),
    longTasks: summarize(detail.tasks.map(item => item.ms)), rowReads: detail.rowReads, rowReadMs: detail.rowReadMs,
    layoutMs: (end.LayoutDuration - before.LayoutDuration) * 1000, layouts: end.LayoutCount - before.LayoutCount,
    scriptMs: (end.ScriptDuration - before.ScriptDuration) * 1000 };
}
async function reading(page) {
  return page.locator('.table-scroll').evaluate(container => {
    const header = container.querySelector('thead').getBoundingClientRect().bottom;
    const row = [...container.querySelectorAll('tr[data-cue-id]')].find(row => row.getBoundingClientRect().bottom > header);
    return { first: row?.dataset.cueId, inset: row ? header - row.getBoundingClientRect().top : null,
      windowed: container.hasAttribute('data-windowed'), mounted: container.querySelectorAll('tr[data-cue-id]').length };
  });
}
function sameReading(before, after) {
  assert.equal(after.first, before.first, JSON.stringify({ before, after }));
  assert(Math.abs(after.inset - before.inset) <= 1, JSON.stringify({ before, after }));
}

console.log(`results: ${output}`);
try {
  for (const rate of rates) for (const count of counts) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    try {
      await installPerformanceFixtures(context, performanceDocument(count), report.errors);
      await context.addInitScript(observe);
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      page.on('pageerror', error => report.errors.push(String(error)));
      page.on('dialog', dialog => dialog.accept());
      const cdp = await context.newCDPSession(page);
      await cdp.send('Performance.enable');
      await cdp.send('Emulation.setCPUThrottlingRate', { rate });
      await page.goto(`${origin}/workspace/local`);
      const bundle = await page.locator('script[type="module"][src]').first().getAttribute('src');
      if (!report.environment.bundle) {
        const response = await context.request.get(new URL(bundle, origin).href);
        assert(response.ok());
        report.environment.bundle = { path: bundle, sha256: createHash('sha256').update(await response.body()).digest('hex') };
      } else assert.equal(bundle, report.environment.bundle.path, 'production bundle changed during measurement');
      await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
      await page.getByLabel('导入本地视频').setInputFiles(media);
      await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready'
        && document.querySelector('.ass-preview-status')?.dataset.phase === 'ready');
      await page.waitForTimeout(500);
      const run = { count, rate, typing: [], search: [], play: [], scroll: [], threshold: [] };
      report.runs.push(run);
      const text = page.getByLabel('字幕中文文本');
      for (let round = 0; round < rounds; round++) {
        await text.focus();
        const sample = await stage(page, cdp, async () => {
          await page.keyboard.type('abcdefghijklmnopqrstuvwx', { delay: 50 });
          await page.waitForTimeout(250);
        });
        assert.equal(sample.inputToTwoRaf.n, 24);
        run.typing.push(sample);
      }
      await page.getByRole('button', { name: '查找字幕', exact: true }).click();
      const input = page.getByRole('textbox', { name: '查找字幕文本', exact: true });
      for (let round = 0; round < rounds; round++) {
        await input.fill(''); await page.waitForTimeout(150); await input.focus();
        const sample = await stage(page, cdp, () => input.pressSequentially('性能测量', { delay: 80 }));
        assert.equal(sample.inputToTwoRaf.n, 4);
        run.search.push(sample);
      }
      await page.getByRole('button', { name: '查找字幕', exact: true }).click();
      for (let round = 0; round < rounds; round++) {
        run.play.push(await stage(page, cdp, async () => {
          await page.locator('video').evaluate(async video => { video.currentTime = 0; video.muted = true; await video.play(); });
          await page.waitForTimeout(5000);
          await page.locator('video').evaluate(video => video.pause());
        }));
        run.scroll.push(await stage(page, cdp, async () => {
          await page.locator('.table-scroll').evaluate(async container => {
            for (let step = 0; step < 20; step++) {
              container.scrollTop += step < 10 ? 100 : -100;
              await new Promise(resolve => setTimeout(resolve, 50));
            }
          });
        }));
      }
      if (count === 201) {
        for (let round = 0; round < rounds; round++) {
          await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
          await page.locator('.table-scroll').evaluate(container => { container.scrollTop = 1500; });
          await page.waitForTimeout(300);
          const before = await reading(page);
          await page.locator('main.editor-workbench').focus();
          await page.waitForTimeout(150);
          const focused = await reading(page);
          const deletion = await stage(page, cdp, async () => {
            await page.keyboard.press('Control+Delete');
            await page.locator('.cue-list table[aria-rowcount="201"]').waitFor();
          });
          const deleted = await reading(page);
          assert.equal(deleted.windowed, false);
          await page.locator('.table-scroll').evaluate(container => { container.scrollTop += 150; });
          await page.waitForTimeout(150);
          const native = await reading(page);
          const undo = await stage(page, cdp, async () => {
            await page.keyboard.press('Control+z');
            await page.locator('.cue-list table[aria-rowcount="202"]').waitFor();
          });
          const restored = await reading(page);
          assert(restored.windowed && restored.mounted < 100);
          run.threshold.push({ deletion, undo, before, focused, deleted, native, restored });
          for (const [label, expected, actual] of [['focus', before, focused], ['delete', before, deleted], ['undo', native, restored]]) {
            try { sameReading(expected, actual); }
            catch (error) { report.readingFailures.push({ count, rate, round, label, message: String(error) }); }
          }
          await page.locator('.table-scroll').evaluate(container => { container.scrollTop = 0; });
          await page.waitForTimeout(150);
        }
      }
      assert.deepEqual(report.errors, []);
      save();
      console.log(JSON.stringify({ count, rate, typingP95: run.typing.map(sample => sample.inputToTwoRaf.p95),
        searchMax: run.search.map(sample => sample.inputToTwoRaf.max), threshold: run.threshold.length }));
    } finally { await context.close(); }
  }
  assert.deepEqual(report.readingFailures, [], 'threshold reading position changed; see readingFailures in results');
} catch (error) {
  report.failure = String(error); process.exitCode = 1; console.error(error);
} finally {
  save();
  await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 3000).unref())]);
  process.exit(process.exitCode || 0);
}
