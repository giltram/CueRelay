import { expect, button, openWorkspace, text, saveDocument } from '../regression/helpers.mjs';

export async function runPlatformFlow(page, browser, writeReport) {
  await openWorkspace(page);
  const capabilities = await page.evaluate(async () => ({
    audioDecoder: typeof AudioDecoder !== 'undefined',
    aac: typeof AudioDecoder !== 'undefined' && (await AudioDecoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 1 })).supported,
    picker: typeof showOpenFilePicker !== 'undefined', webLocks: !!navigator.locks,
    video: document.querySelector('video').canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'),
  }));
  // Observe the actual Worker result. Capability degradation must leave project editing usable.
  const timeline = page.locator('.audio-timeline');
  await expect(timeline).toHaveAttribute('data-state', capabilities.aac ? 'ready' : 'error', { timeout: 30000 });
  if (!capabilities.aac) await expect(page.locator('.audio-message')).toContainText('WebCodecs');
  await page.locator('video').evaluate(async video => { video.muted = true; await video.play(); });
  await expect.poll(() => page.locator('video').evaluate(video => video.currentTime)).toBeGreaterThan(.1);
  await page.locator('video').evaluate(video => video.pause());
  const audioState = await timeline.getAttribute('data-state');
  await text(page).fill('跨浏览器真实保存'); await saveDocument(page, 1);
  await page.reload();
  await expect(button(page, '跨浏览器真实保存')).toBeVisible();
  await page.goto('/settings');
  const popup = page.waitForEvent('popup');
  await page.getByRole('region', { name: '使用手册' }).getByRole('link', { name: '打开使用手册' }).click();
  const manual = await popup; await expect(manual.getByRole('article')).toBeVisible();
  await writeReport({ browser: browser.version(), capabilities, audioState });
}
