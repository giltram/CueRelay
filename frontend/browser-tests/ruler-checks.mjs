import assert from 'node:assert/strict';
import { join } from 'node:path';

/** Observe real canvas calls without adding diagnostics to the product. */
export async function observeRuler(page) {
  await page.addInitScript(() => {
    window.__rulerDraws = new WeakMap();
    const prototype = CanvasRenderingContext2D.prototype;
    const fillRect = prototype.fillRect;
    const fillText = prototype.fillText;
    prototype.fillRect = function(x, y, width, height) {
      if (this.canvas.closest('.audio-stage')) {
        if (x === 0 && y === 0) window.__rulerDraws.set(this.canvas, { labels: [], ticks: [] });
        if (y >= 15 && y < 22 && width <= 1.01) window.__rulerDraws.get(this.canvas)?.ticks.push({ x, y, width, height });
      }
      return fillRect.call(this, x, y, width, height);
    };
    prototype.fillText = function(text, x, y, ...args) {
      if (y < 22) window.__rulerDraws.get(this.canvas)?.labels.push({ text, x, y, width: this.measureText(text).width });
      return fillText.call(this, text, x, y, ...args);
    };
  });
}

export async function checkRuler(page, directory) {
  const originalMode = await page.locator('.audio-timeline').getAttribute('data-mode');
  await page.getByRole('button', { name: 'Spectrum', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.audio-timeline').dataset.state === 'ready');
  const stage = page.locator('.audio-stage');
  const canvas = stage.locator('canvas');
  const bounds = () => page.locator('.audio-timeline').evaluate(el => ({
    start: Number(el.dataset.start), span: Number(el.dataset.end) - Number(el.dataset.start),
  }));
  const original = await bounds();
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const wheel = async (delta, shiftKey = false) => {
    const rect = await stage.boundingBox();
    await stage.dispatchEvent('wheel', { deltaY: delta, deltaX: 0, deltaMode: 0, shiftKey, clientX: rect.x });
    await settle();
  };
  const setSpan = async span => {
    for (let i = 0; i < 12; i++) {
      const current = await bounds();
      if (Math.abs(current.span - span) < 1e-7) return;
      await wheel(Math.max(-0.7, Math.min(0.7, Math.log(span / current.span))) / 0.004, true);
    }
    assert.fail('zoom did not reach the requested span');
  };
  const setStart = async start => {
    const current = await bounds();
    const { width } = await stage.boundingBox();
    await wheel((start - current.start) / current.span * width);
  };
  const snapshot = () => canvas.evaluate(el => {
    const context = el.getContext('2d');
    return { ...window.__rulerDraws.get(el), width: el.getBoundingClientRect().width, backingWidth: el.width, dpr: window.devicePixelRatio,
      background: [...context.getImageData(1, Math.round(14 * window.devicePixelRatio), 1, 1).data] };
  });
  const noOverlap = result => result.labels.forEach((label, index) => {
    assert(label.x + label.width <= result.width);
    if (index) assert(label.x >= result.labels[index - 1].x + result.labels[index - 1].width + 4);
  });
  const report = {};
  await setSpan((await stage.boundingBox()).width / 225);
  await setStart(4.57);
  report.reference = await snapshot();
  assert.deepEqual(report.reference.labels.slice(0, 2).map(label => label.text), ['0:00:05', '06']);
  assert(Math.abs(report.reference.labels[0].x - 96.75) < 0.01);
  assert.deepEqual(report.reference.background, [8, 8, 12, 255]);
  assert(report.reference.ticks.some(tick => tick.height === 6));
  assert(report.reference.ticks.some(tick => tick.height === 4));
  report.screenshot = join(directory, 'aegisub-ruler.png');
  await stage.screenshot({ path: report.screenshot });
  await setStart(4.67);
  report.pan = await snapshot();
  assert(Math.abs(report.pan.labels[0].x - report.reference.labels[0].x + 22.5) < 0.01);
  // Clicking the label's x at ruler height still seeks through the original stage handler.
  await stage.click({ position: { x: report.pan.labels[0].x, y: 10 } });
  assert(Math.abs(await page.locator('video').evaluate(video => video.currentTime) - 5) < 0.05);
  await setSpan((await stage.boundingBox()).width / 500);
  report.zoomIn = await snapshot();
  assert(report.zoomIn.labels.some(label => /^\d{2}\.\d$/.test(label.text)));
  await setSpan((await stage.boundingBox()).width / 20);
  await setStart(0);
  report.zoomOut = await snapshot();
  assert.deepEqual(report.zoomOut.labels.slice(0, 3).map(label => label.text), ['0:00:00', '10', '20']);
  for (const result of [report.reference, report.pan, report.zoomIn, report.zoomOut]) noOverlap(result);

  const session = await page.context().newCDPSession(page);
  report.resolutions = [];
  for (const dpr of [3, 1.25, 1]) {
    await session.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: dpr, mobile: false });
    await page.waitForFunction(ratio => {
      const canvas = document.querySelector('.audio-stage canvas');
      return window.devicePixelRatio === ratio && canvas.width === Math.round(canvas.getBoundingClientRect().width * ratio);
    }, dpr);
    const result = await snapshot(); noOverlap(result);
    report.resolutions.push({ dpr, cssWidth: result.width, backingWidth: result.backingWidth });
  }
  await session.send('Emulation.clearDeviceMetricsOverride');
  await session.detach();
  await page.setViewportSize({ width: 800, height: 900 });
  await settle();
  report.narrow = await snapshot(); noOverlap(report.narrow);
  assert.equal(report.narrow.backingWidth, Math.round(report.narrow.width * report.narrow.dpr));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await settle();
  await setSpan(original.span); await setStart(original.start);
  if (originalMode === 'waveform') await page.getByRole('button', { name: 'Waveform', exact: true }).click();
  for (const result of [report.reference, report.pan, report.zoomIn, report.zoomOut, report.narrow]) {
    result.tickCount = result.ticks.length;
    delete result.ticks;
  }
  return report;
}
