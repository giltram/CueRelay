// Real account preference persistence and live editor preservation.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setAudioMode } from './audio-settings.mjs';

const baseURL = process.env.PROJECTS_URL || 'http://127.0.0.1:5196';
const password = process.env.BROWSER_TEST_PASSWORD;
if (!password) throw new Error('Set BROWSER_TEST_PASSWORD and seed disposable project fixtures');
const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-audio-preferences-'));
const file = join(artifacts, 'audio.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=20',
  '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=20', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
context.setDefaultTimeout(15000);
const errors = [], checks = [];
context.on('page', page => {
  page.on('pageerror', error => errors.push(String(error)));
  page.on('dialog', dialog => { if (dialog.type() === 'beforeunload') void dialog.accept(); else void dialog.dismiss(); });
});
const page = await context.newPage();
const record = label => { checks.push(label); console.log('PASS', label); };
async function login(target, username) {
  await target.getByLabel('用户名', { exact: true }).fill(username);
  await target.getByLabel('密码', { exact: true }).fill(password);
  await target.getByRole('button', { name: '登录', exact: true }).click();
}
async function settingsTab() {
  const popup = context.waitForEvent('page');
  await page.getByRole('link', { name: '设置', exact: true }).click();
  const settings = await popup; await settings.getByLabel('音频显示模式', { exact: true }).waitFor();
  return settings;
}
async function snapshot() {
  return page.evaluate(() => ({
    sameVideo: window.__preferenceVideo === document.querySelector('video'),
    sameTimeline: window.__preferenceTimeline === document.querySelector('.audio-timeline'),
    src: document.querySelector('video').src, time: document.querySelector('video').currentTime,
    text: document.querySelector('textarea').value, start: document.querySelector('input[aria-label="入点"]').value,
    end: document.querySelector('input[aria-label="出点"]').value, selected: document.querySelector('tr.selected')?.textContent,
    view: [document.querySelector('.audio-timeline').dataset.start, document.querySelector('.audio-timeline').dataset.end],
    decoded: document.querySelector('.audio-timeline').dataset.decodedSegments,
  }));
}
try {
  await page.goto('/workspace/local'); await login(page, 'project-organizer');
  await page.locator('video').waitFor();
  assert.equal(await page.getByRole('button', { name: /^(Waveform|Spectrum)$/ }).count(), 0);
  assert.equal(await page.locator('.audio-mode-switch').count(), 0);
  assert.equal(await page.locator('.audio-timeline').getAttribute('data-mode'), 'spectrum');
  await page.getByLabel('导入本地视频').setInputFiles(file);
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
  await page.getByLabel('字幕中文文本').fill('音频显示偏好保留稿件');
  await page.getByLabel('入点', { exact: true }).fill('0:00:00.30');
  await page.getByLabel('出点', { exact: true }).fill('0:00:01.80');
  await page.locator('video').evaluate(video => { video.currentTime = 1.25; });
  await page.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 1.25) < 0.01);
  await page.evaluate(() => {
    window.__preferenceVideo = document.querySelector('video');
    window.__preferenceTimeline = document.querySelector('.audio-timeline');
  });
  const before = await snapshot();
  await setAudioMode(page, 'waveform');
  await page.waitForFunction(() => document.querySelector('.audio-timeline').dataset.state === 'ready');
  assert.deepEqual(await snapshot(), before);
  record('工作区入口已移除，默认 Spectrum；新标签页保存 Waveform 后回到原页生效，video/时间轴节点/字幕/草稿/播放位置/视窗/PCM 解码计数保持');

  const settings = await settingsTab();
  assert.equal(await settings.getByLabel('音频显示模式', { exact: true }).inputValue(), 'waveform');
  await settings.reload(); await settings.getByLabel('音频显示模式', { exact: true }).waitFor();
  assert.equal(await settings.getByLabel('音频显示模式', { exact: true }).inputValue(), 'waveform');
  await settings.route('**/api/me/settings', route => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unavailable', message: '显示设置保存失败' } }) }) : route.continue());
  await settings.getByLabel('音频显示模式', { exact: true }).selectOption('spectrum');
  await settings.getByRole('button', { name: '保存显示设置', exact: true }).click();
  await settings.getByText('显示设置保存失败', { exact: true }).waitFor();
  assert.equal(await settings.getByLabel('音频显示模式', { exact: true }).inputValue(), 'spectrum');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  assert.equal(await page.locator('.audio-timeline').getAttribute('data-mode'), 'waveform');
  assert.deepEqual(await snapshot(), before);
  await settings.close();
  const refreshed = await settingsTab();
  assert.equal(await refreshed.getByLabel('音频显示模式', { exact: true }).inputValue(), 'waveform');
  await refreshed.getByLabel('提交并下一条绑定').fill('Shift+KeyT');
  await refreshed.getByRole('button', { name: '保存快捷键', exact: true }).click();
  await refreshed.getByText('已保存', { exact: true }).waitFor();
  await refreshed.reload(); await refreshed.getByLabel('音频显示模式', { exact: true }).waitFor();
  assert.equal(await refreshed.getByLabel('音频显示模式', { exact: true }).inputValue(), 'waveform');
  assert.equal(await refreshed.getByLabel('提交并下一条绑定').inputValue(), 'Shift+KeyT');
  await refreshed.setViewportSize({ width: 390, height: 844 });
  assert(await refreshed.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await refreshed.screenshot({ path: join(artifacts, 'settings-mobile.png'), fullPage: true });
  await refreshed.close();
  record('偏好刷新后保留；失败不应用且保留选择；保存快捷键不覆盖显示模式，窄屏设置无横向溢出');

  const isolated = await browser.newContext({ baseURL });
  const other = await isolated.newPage();
  await other.goto('/settings'); await login(other, 'project-member');
  await other.getByLabel('音频显示模式', { exact: true }).waitFor();
  assert.equal(await other.getByLabel('音频显示模式', { exact: true }).inputValue(), 'spectrum');
  await isolated.close();
  record('显示偏好按账号隔离，另一账号保持默认 Spectrum');

  await page.locator('video').evaluate(async video => { video.muted = true; await video.play(); });
  const playing = await page.locator('video').evaluate(video => video.currentTime);
  await setAudioMode(page, 'spectrum');
  await page.waitForFunction(() => document.querySelector('.audio-timeline').dataset.state === 'ready');
  assert.equal(await page.locator('video').evaluate(video => video.paused), false);
  assert(await page.locator('video').evaluate((video, time) => video.currentTime > time, playing));
  await page.locator('video').evaluate(video => video.pause());
  const after = await snapshot();
  for (const key of ['sameVideo', 'sameTimeline', 'src', 'text', 'start', 'end', 'selected', 'view', 'decoded']) assert.deepEqual(after[key], before[key], key);
  const finalSettings = await settingsTab();
  assert.equal(await finalSettings.getByLabel('音频显示模式', { exact: true }).inputValue(), 'spectrum');
  assert.equal(await finalSettings.getByLabel('提交并下一条绑定').inputValue(), 'Shift+KeyT');
  await finalSettings.screenshot({ path: join(artifacts, 'settings-desktop.png'), fullPage: true });
  await finalSettings.getByRole('button', { name: '全部恢复默认', exact: true }).click();
  await finalSettings.getByRole('button', { name: '保存快捷键', exact: true }).click();
  await finalSettings.getByText('已保存', { exact: true }).waitFor();
  await finalSettings.close();
  await page.screenshot({ path: join(artifacts, 'workspace.png'), fullPage: true });
  record('播放中切回 Spectrum 继续播放且不清空状态、不重建解码；保存显示模式也不覆盖快捷键');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: browser.version(), checks, errors, artifacts }, null, 2));
} catch (error) {
  console.error(error); await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }); throw error;
} finally { await context.close(); await browser.close(); }
