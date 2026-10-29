import { setAudioMode } from './audio-settings.mjs';
import assert from 'node:assert/strict';

/** Real pointer capture, seek callbacks and video time; no test hooks in the product. */
export async function checkPlayhead(page, bounds) {
  const originalMode = await page.locator('.audio-timeline').getAttribute('data-mode');
  const stage = page.locator('.audio-stage');
  const marker = page.getByLabel('音频播放头', { exact: true });
  const readTime = () => page.locator('video').evaluate(video => video.currentTime);
  const assertView = async expected => {
    const current = await bounds();
    assert(Math.abs(current.start - expected.start) < 1e-6);
    assert(Math.abs(current.end - expected.end) < 1e-6);
  };
  const dragTo = async (fraction, cancel = false) => {
    await page.waitForFunction(() => !document.querySelector('.audio-playhead').hidden);
    const view = await bounds(); const rect = await stage.boundingBox(); const handle = await marker.boundingBox();
    // Grab off-center, staying inside the clipped hit target at either viewport edge.
    const y = handle.y + handle.height / 2;
    const startX = Math.max(rect.x + 1, Math.min(rect.x + rect.width - 1, handle.x + 3));
    const grabOffset = startX - (handle.x + handle.width / 2);
    const tolerance = await page.locator('video').evaluate(video => video.paused ? 0.02 : 0.5);
    await page.mouse.move(startX, y);
    assert.equal(await marker.evaluate(el => getComputedStyle(el).cursor), 'ew-resize');
    const before = await readTime();
    await page.mouse.down();
    assert(Math.abs(await readTime() - before) < 0.05);
    await page.mouse.move(rect.x + rect.width * fraction + grabOffset, y, { steps: 8 });
    const expected = view.start + Math.max(0, Math.min(1, fraction)) * (view.end - view.start);
    await page.waitForFunction(({ time, tolerance }) => Math.abs(document.querySelector('video').currentTime - time) < tolerance,
      { time: expected, tolerance });
    if (cancel) {
      await stage.dispatchEvent('pointercancel', { pointerId: 1 });
      await page.mouse.move(rect.x + rect.width * 0.9, y);
    }
    await page.mouse.up();
    await page.waitForFunction(() => !document.querySelector('video').seeking);
    await assertView(view);
    assert(Math.abs(await readTime() - expected) < tolerance);
    return { expected, actual: await readTime() };
  };

  const report = { paused: await dragTo(0.7) };
  assert(await page.locator('video').evaluate(video => video.paused));
  report.rightEdge = await dragTo(1.2);
  report.leftEdge = await dragTo(-0.2);
  report.cancel = await dragTo(0.5, true);
  await setAudioMode(page, 'spectrum');
  await page.waitForFunction(() => document.querySelector('.audio-timeline').dataset.state === 'ready');
  await page.locator('video').evaluate(video => video.play());
  report.playing = await dragTo(0.55);
  assert.equal(await page.locator('video').evaluate(video => video.paused), false);
  await page.locator('video').evaluate(video => { video.pause(); video.currentTime = 44.5; });
  await page.waitForFunction(() => Number(document.querySelector('.audio-timeline').dataset.end) === 45);
  report.mediaEnd = await dragTo(1.2);
  assert.equal(await readTime(), 45);
  if (originalMode === 'waveform') await setAudioMode(page, 'waveform');
  return report;
}
