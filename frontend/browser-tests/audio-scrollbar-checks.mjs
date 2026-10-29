import assert from 'node:assert/strict';

/** Exercise the shared viewport through its compact scrollbar with real pointer capture. */
export async function checkAudioScrollbar(page) {
  const bar = page.getByRole('scrollbar', { name: '音频横向滚动' });
  const thumb = bar.locator('.audio-scrollbar-thumb');
  const stage = page.locator('.audio-stage');
  const bounds = () => page.locator('.audio-timeline').evaluate(el => ({ start: +el.dataset.start, end: +el.dataset.end }));
  const frame = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const before = await page.evaluate(() => ({
    time: document.querySelector('video').currentTime,
    draft: [...document.querySelectorAll('.time-point input')].map(el => el.value),
  }));
  const initial = await bounds();
  const track = await bar.boundingBox(); const plot = await stage.boundingBox();
  assert(track.height <= 10 && Math.abs(track.width - plot.width) < 1);
  assert(Math.abs(track.y - plot.y - plot.height) < 1);
  const zoom = await page.locator('.audio-vertical-zoom').boundingBox();
  assert(zoom.width <= 18);
  const first = await thumb.boundingBox();
  assert(Math.abs(first.width / track.width - (initial.end - initial.start) / 45) < 0.01);
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down(); await page.mouse.move(track.x + track.width + 100, first.y + 2, { steps: 10 });
  await frame();
  const atEnd = await bounds(); assert(Math.abs(atEnd.end - 45) < 0.01);
  await page.mouse.up();
  const last = await thumb.boundingBox(); assert(Math.abs(last.x + last.width - track.x - track.width) < 1);
  await bar.focus(); await page.keyboard.press('Home'); await frame();
  assert.equal((await bounds()).start, 0);
  await page.keyboard.press('ArrowRight'); await frame();
  assert(Math.abs((await bounds()).start - 1) < 0.01);
  await page.keyboard.press('PageDown'); await frame();
  assert(Math.abs((await bounds()).start - 11) < 0.01);
  await page.keyboard.press('End'); await frame(); assert.equal((await bounds()).end, 45);
  await page.mouse.click(track.x + track.width / 2, track.y + track.height / 2); await frame();
  const middle = await bounds(); assert(Math.abs((middle.start + middle.end) / 2 - 22.5) < 0.1);
  assert.equal(Number(await bar.getAttribute('aria-valuenow')), middle.start);
  await page.mouse.move(plot.x + plot.width / 2, plot.y + 10);
  await page.mouse.wheel(0, 100); await frame();
  const panned = await bounds(); assert(panned.start > middle.start);
  assert.equal(Number(await bar.getAttribute('aria-valuenow')), panned.start);
  await page.keyboard.down('Shift'); await page.mouse.wheel(0, -120); await page.keyboard.up('Shift'); await frame();
  const scaled = await thumb.boundingBox(); assert(scaled.width < first.width);
  await page.keyboard.down('Shift');
  for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -1000); await frame(); }
  await page.keyboard.up('Shift');
  const minimum = await thumb.boundingBox(); assert(Math.abs(minimum.width - 24) < 1);
  await page.mouse.move(minimum.x + minimum.width / 2, minimum.y + minimum.height / 2);
  await page.mouse.down(); await page.mouse.move(track.x + track.width + 100, minimum.y + 2, { steps: 10 });
  await page.mouse.up(); await frame();
  assert(Math.abs((await bounds()).end - 45) < 0.01);
  // Zooming out to the full short clip disables scrolling and fills the track.
  await page.keyboard.down('Shift');
  await page.mouse.move(plot.x + plot.width / 2, plot.y + 10);
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 1000); await frame(); }
  await page.keyboard.up('Shift');
  assert.equal(await bar.getAttribute('aria-disabled'), 'true');
  assert(Math.abs((await thumb.boundingBox()).width - track.width) < 1);
  const after = await page.evaluate(() => ({
    time: document.querySelector('video').currentTime,
    draft: [...document.querySelectorAll('.time-point input')].map(el => el.value),
  }));
  assert.deepEqual(after, before);
  // Return the existing rendering regression to its original ten-second viewport.
  await page.keyboard.down('Shift');
  for (const delta of [-Math.log(2) / 0.004, -Math.log(2) / 0.004, -Math.log(1.125) / 0.004]) {
    await page.mouse.wheel(0, delta); await frame();
  }
  await page.keyboard.up('Shift');
  await bar.focus(); await page.keyboard.press('Home'); await frame();
  const restored = await bounds(); assert(Math.abs(restored.end - 10) < 0.001);
  await page.waitForFunction(() => document.querySelector('.audio-timeline').dataset.state === 'ready');
  return { height: track.height, verticalZoomWidth: zoom.width, atEnd, middle, restored };
}
