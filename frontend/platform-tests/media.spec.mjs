import { writeFile } from 'node:fs/promises';
import { test, expect, fixtures, button, openWorkspace, readProject } from '../regression/helpers.mjs';
import { sameTab } from '../browser-tests/link-navigation.mjs';

// Passive instrumentation: only finite metadata/counters, never retain PCM or private media.
function observe() {
  const stats = window.__media = { workers: 0, terminated: 0, contexts: 0, closed: 0,
    urls: 0, revoked: 0, pcmMessages: 0, maxPcmBytes: 0, channels: [], scheduled: 0 };
  const WorkerBase = window.Worker;
  window.Worker = class extends WorkerBase {
    constructor(...args) {
      super(...args); stats.workers++;
      this.addEventListener('message', ({ data }) => {
        if (data?.type === 'ready' && data.metadata?.channels) stats.channels.push(data.metadata.channels);
        if (data?.type === 'pcm') {
          stats.pcmMessages++;
          stats.maxPcmBytes = Math.max(stats.maxPcmBytes, data.chunks.reduce((bytes, chunk) => bytes + chunk.channels.reduce((n, channel) => n + channel.byteLength, 0), 0));
          for (const chunk of data.chunks) if (!stats.channels.includes(chunk.channels.length)) stats.channels.push(chunk.channels.length);
        }
      });
    }
    terminate() { if (!this.ended) { this.ended = true; stats.terminated++; } return super.terminate(); }
  };
  const ContextBase = window.AudioContext;
  window.AudioContext = class extends ContextBase {
    constructor(...args) { super(...args); stats.contexts++; }
    close() { return super.close().then(() => { stats.closed++; }); }
    createBufferSource() {
      const node = super.createBufferSource(), start = node.start.bind(node);
      node.start = (...args) => { stats.scheduled++; return start(...args); };
      return node;
    }
  };
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (...args) => { stats.urls++; return create(...args); };
  URL.revokeObjectURL = (...args) => { stats.revoked++; return revoke(...args); };
}

test('media bounded 180 second six channel seek preview audition and cleanup', async ({ page, browser }, info) => {
  test.setTimeout(180000);
  await page.addInitScript(observe);
  await openWorkspace(page);
  const timeline = page.locator('.audio-timeline');
  await expect(timeline).toHaveAttribute('data-state', 'ready', { timeout: 30000 });
  await expect(page.locator('.ass-preview-status')).toHaveAttribute('data-phase', 'ready', { timeout: 30000 });
  expect(await page.locator('video').evaluate(video => video.duration)).toBeCloseTo(180, 1);
  const emptyFrame = await page.locator('.ass-preview-canvas').screenshot({ path: info.outputPath('subtitle-empty.png') });
  const cache = async () => Number(await timeline.getAttribute('data-cache-bytes'));
  for (const target of [150.5, 5, 175, 150.5]) {
    await page.locator('video').evaluate((video, target) => { video.pause(); video.currentTime = target; }, target);
    await expect.poll(() => page.locator('video').evaluate(video => !video.seeking && video.currentTime)).toBe(target);
    await expect.poll(async () => Number(await timeline.getAttribute('data-start')) <= target
      && Number(await timeline.getAttribute('data-end')) >= target).toBe(true);
    await expect(timeline).toHaveAttribute('data-state', 'ready', { timeout: 30000 });
    expect(await cache()).toBeGreaterThan(0); expect(await cache()).toBeLessThanOrEqual(32 * 1024 ** 2);
  }
  const canvas = page.locator('.ass-preview-canvas');
  const visible = await canvas.screenshot({ path: info.outputPath('subtitle-visible.png') });
  expect(visible.equals(emptyFrame)).toBe(false);
  await button(page, '显示预览字幕').click(); await expect(canvas).toHaveCount(0);
  await button(page, '显示预览字幕').click();
  await expect(page.locator('.ass-preview-status')).toHaveAttribute('data-phase', 'ready');
  const restored = await canvas.screenshot(); expect(restored).toEqual(visible);
  await page.locator('main.editor-workbench').focus(); await page.keyboard.press('Space');
  await expect(timeline).toHaveAttribute('data-audition-phase', 'finished', { timeout: 15000 });
  const audition = await page.evaluate(() => window.__media);
  expect(audition.channels).toContain(6); expect(audition.pcmMessages).toBeGreaterThanOrEqual(3);
  expect(audition.maxPcmBytes).toBeLessThanOrEqual(4 * 1024 ** 2);
  expect(audition.scheduled).toBeGreaterThan(0);
  expect(await page.locator('video').evaluate(video => video.currentTime)).toBe(150.5);
  const prior = await readProject(page); expect(prior.revision).toBe(1);
  await sameTab(page.getByRole('link', { name: '项目列表', exact: true }));
  await expect(page.locator('main.editor-workbench')).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__media.closed)).toBe(audition.contexts);
  // Re-enter retained instance, then explicitly discard/unmount via the home link.
  await page.goBack(); await expect(page.locator('main.editor-workbench')).toBeVisible();
  await button(page, '显示预览字幕').click(); await expect(canvas).toHaveCount(0);
  // Navigating to another project/local workspace destroys the retained instance.
  await sameTab(page.getByRole('link', { name: 'CueRelay', exact: true }));
  await sameTab(page.getByRole('link', { name: '本地工作区', exact: true }));
  await expect.poll(() => page.evaluate(() => window.__media.workers === window.__media.terminated)).toBe(true);
  const released = await page.evaluate(() => window.__media);
  expect(released.contexts).toBe(released.closed); expect(released.urls).toBe(released.revoked);
  await writeFile(info.outputPath('media.json'), JSON.stringify({ browser: browser.version(),
    measured: fixtures.mediaSpecification,
    specification: { seconds: 180, channels: 6, sampleRate: 48000, video: 'H264 320x180 10fps', audio: 'AAC 384kbps 5.1',
      fileBudgetBytes: 16 * 1024 ** 2, analysisBudgetBytes: 32 * 1024 ** 2, auditionMessageBudgetBytes: 4 * 1024 ** 2 },
    audition, released, limitation: 'Synthetic media and cleanup calls do not prove audible output or native memory release' }, null, 2));
});
