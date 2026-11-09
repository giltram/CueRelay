import assert from 'node:assert/strict';
import { sameTab } from './link-navigation.mjs';

export async function observeTimelineReuse(page) {
  await page.addInitScript(() => {
    window.__timelineReuse = { frames: 0, canvases: 0 };
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => raf(time => { window.__timelineReuse.frames++; callback(time); });
    const create = document.createElement.bind(document);
    document.createElement = (name, ...args) => {
      if (name === 'canvas') window.__timelineReuse.canvases++;
      return create(name, ...args);
    };
  });
}

export async function checkTimelineReuse(page) {
  const ready = () => page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
  const wheel = () => page.locator('.audio-stage').evaluate(el => el.dispatchEvent(new WheelEvent('wheel', {
    deltaY: 1, bubbles: true, cancelable: true, clientX: el.getBoundingClientRect().left + 100,
  })));
  await page.locator('video').evaluate(video => { video.pause(); video.currentTime = 15; });
  await page.waitForFunction(() => !document.querySelector('video').seeking);
  await ready(); await wheel(); await ready(); await page.waitForTimeout(150);
  const before = await page.locator('.audio-timeline').evaluate(el => ({ decoded: el.dataset.decodedSegments,
    canvases: window.__timelineReuse.canvases }));
  for (let index = 0; index < 20; index++) { await wheel(); await ready(); }
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.audio-timeline').getAttribute('data-decoded-segments'), before.decoded);
  assert.equal(await page.evaluate(() => window.__timelineReuse.canvases), before.canvases);

  await page.evaluate(() => {
    window.__timelineMutations = 0;
    window.__timelineObserver = new MutationObserver(entries => { window.__timelineMutations += entries.length; });
    window.__timelineObserver.observe(document.querySelector('.audio-timeline'), { subtree: true, childList: true, attributes: true });
    window.__timelineIdleStart = window.__timelineReuse.frames;
  });
  await page.waitForTimeout(2000);
  const idle = await page.evaluate(() => {
    window.__timelineObserver.disconnect();
    return { frames: window.__timelineReuse.frames - window.__timelineIdleStart, mutations: window.__timelineMutations };
  });
  assert.deepEqual(idle, { frames: 0, mutations: 0 });
  await sameTab(page.getByRole('link', { name: '项目列表', exact: true }));
  await page.locator('main.editor-workbench').waitFor({ state: 'hidden' }); await page.waitForTimeout(150);
  const hiddenStart = await page.evaluate(() => window.__timelineReuse.frames);
  await page.waitForTimeout(2000);
  assert.equal(await page.evaluate(() => window.__timelineReuse.frames), hiddenStart);
  await page.goBack(); await page.locator('main.editor-workbench').waitFor({ state: 'visible' });
  await page.locator('video').evaluate(video => { video.currentTime = 12.34; });
  await page.waitForFunction(() => !document.querySelector('video').seeking
    && document.querySelector('.audio-footer > span > span').textContent === '0:00:12.34'
    && !document.querySelector('.audio-playhead').hidden);
  await page.locator('video').evaluate(video => { video.currentTime = 0; });
  await page.waitForFunction(() => !document.querySelector('video').seeking);
  await ready();
  return { sameTilesNoCanvases: true, idle, hiddenFrames: 0, restoreAndPausedSeek: true };
}
