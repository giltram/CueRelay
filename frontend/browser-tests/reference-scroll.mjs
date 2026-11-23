// Production browser acceptance. Isolated HTTP, real parser/media/audio; no database writes.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { referenceFixture, referenceMedia, installReferenceFixture, openReference, settle, referenceReading, currentVisible } from './reference-scroll-fixtures.mjs';
const watchdog = setTimeout(() => { console.error('Reference acceptance exceeded 90s'); process.exit(1); }, 90000);
const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-reference-scroll-'));
const origin = process.env.REFERENCE_SCROLL_URL || 'http://127.0.0.1:5282';
const fixture = referenceFixture(5000), media = referenceMedia(artifacts);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--disable-audio-output'] });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const errors = [], unexpected = [], checks = [];
const controller = await installReferenceFixture(context, fixture.cues, media.media, unexpected);
await context.addInitScript(() => { window.__referenceReads = 0; const rect = Element.prototype.getBoundingClientRect; Element.prototype.getBoundingClientRect = function (...args) { if (this.hasAttribute('data-reference-row')) window.__referenceReads++; return rect.apply(this, args); }; window.__contexts = []; const Native = window.AudioContext; window.AudioContext = class extends Native { constructor(...args) { super(...args); window.__contexts.push(this); } }; });
const page = await context.newPage(); page.setDefaultTimeout(10000);
page.on('pageerror', error => errors.push(String(error)));
const content = page.locator('.reference-content'), main = page.locator('main.editor-workbench');
const select = async number => { await page.getByRole('button', { name: `选择第 ${number} 行`, exact: true }).click(); await settle(page); };
const browse = async fraction => { await content.evaluate((node, fraction) => { node.scrollTop = (node.scrollHeight - node.clientHeight) * fraction; }, fraction); await settle(page); };
async function located() { assert(await currentVisible(page), JSON.stringify(await referenceReading(page))); }
const sameReading = (a, b) => { assert.equal(b.key, a.key, JSON.stringify({ a, b })); assert(Math.abs(a.inset - b.inset) < 2, JSON.stringify({ a, b })); };
try {
  await openReference(page, origin, media.file);
  assert((await referenceReading(page)).mounted < 60);
  await browse(1); assert(Number((await referenceReading(page)).key.slice(4)) >= 4980);
  assert(await content.locator('[data-reference-row="cue-4999"]').count());
  await browse(0); assert.equal((await referenceReading(page)).key, 'cue-0');
  await browse(.4); const reading = await referenceReading(page);
  await controller.refresh(page); sameReading(reading, await referenceReading(page));
  console.log('check', checks.length + 1); checks.push('5000条可到首尾；窗口节点有界；相同版本观察保留阅读位置');
  await select(51); await located();
  assert(await content.locator('[data-reference-current]').first().evaluate(node => Number(node.dataset.referenceRow.slice(4)) > 2400));
  await browse(.85); await select(51); await located();
  console.log('check', checks.length + 1); checks.push('主表中段远距定位及同一行重复点击重新定位');
  await page.locator('video').evaluate(async video => { video.currentTime = 1; video.muted = true; await video.play(); });
  await settle(page); await located();
  await content.hover(); await page.mouse.wheel(0, 800); await settle(page);
  await browse(.8); const manual = await referenceReading(page);
  await page.waitForTimeout(700); sameReading(manual, await referenceReading(page));
  await page.locator('video').evaluate(video => video.pause()); await settle(page); sameReading(manual, await referenceReading(page));
  await page.locator('video').evaluate(video => video.play()); await settle(page); await located();
  await page.locator('video').evaluate(video => video.pause()); await settle(page);
  console.log('check', checks.length + 1); checks.push('真实视频开始/恢复定位；播放跨字幕及暂停均不抢回手动浏览位置');
  await select(21);
  await page.locator('video').evaluate(video => { video.currentTime = 2; });
  await page.waitForFunction(() => !document.querySelector('video').seeking);
  await browse(.9);
  await main.focus(); await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.auditionPhase === 'playing');
  await settle(page); await located();
  assert((await content.locator('[data-reference-current]').first().getAttribute('data-reference-row')).startsWith('cue-10'));
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.auditionPhase !== 'playing');
  assert(Math.abs(await page.locator('video').evaluate(video => video.currentTime) - 2) < .01);
  console.log('check', checks.length + 1); checks.push('真实Web Audio试听启动按音频时钟定位（视频停在2秒、音频从5秒播放）');
  const clock = await page.evaluate(() => window.__contexts.map(c => c.currentTime));
  assert(clock.some(time => time > .2), 'native AudioContext rendering clock advanced');
  // Retained workspace invisibility must disconnect reference measurement.
  await page.getByRole('link', { name: 'CueRelay', exact: true }).click(); await settle(page);
  const hiddenReads = await page.evaluate(() => window.__referenceReads);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__referenceReads), hiddenReads);
  await page.goBack(); await content.waitFor({ state: 'visible' }); await settle(page); await located();
  console.log('check', checks.length + 1); checks.push('同页隐藏停止参考测量，历史返回恢复；原生音频时钟实际推进');
  await browse(.43); const beforeResize = await referenceReading(page);
  const separator = page.getByRole('separator', { name: '调整视频区域大小', exact: true });
  await separator.focus(); await page.keyboard.press('ArrowRight'); await settle(page);
  sameReading(beforeResize, await referenceReading(page));
  await page.setViewportSize({ width: 1100, height: 620 }); await settle(page);
  sameReading(beforeResize, await referenceReading(page));
  await page.setViewportSize({ width: 1440, height: 900 }); await settle(page);
  sameReading(beforeResize, await referenceReading(page));
  await select(51);
  await content.evaluate(container => { container.scrollTop = container.querySelector('[data-reference-row="cue-2500"]').offsetTop + 45; });
  await settle(page); const longReading = await referenceReading(page); assert.equal(longReading.key, 'cue-2500');
  await page.setViewportSize({ width: 1100, height: 620 }); await settle(page); sameReading(longReading, await referenceReading(page));
  await page.setViewportSize({ width: 1440, height: 900 }); await settle(page); sameReading(longReading, await referenceReading(page));
  await page.setViewportSize({ width: 390, height: 844 }); await settle(page);
  await content.scrollIntoViewIfNeeded(); assert((await referenceReading(page)).viewport <= 120);
  await browse(1); assert.equal(await content.locator('[data-reference-row="cue-4999"]').count(), 1);
  await browse(0); assert.equal((await referenceReading(page)).key, 'cue-0');
  await page.setViewportSize({ width: 1440, height: 900 }); await settle(page);
  console.log('check', checks.length + 1); checks.push('分栏与宽高变化保持长段行内45px锚点；390px窄屏5000条仍可到首尾');
  await select(51); await page.getByRole('button', { name: '收起参考字幕', exact: true }).click();
  assert.equal(await content.count(), 0);
  const collapsedReads = await page.evaluate(() => window.__referenceReads);
  await page.waitForTimeout(150); assert.equal(await page.evaluate(() => window.__referenceReads), collapsedReads);
  await page.getByRole('button', { name: '展开参考字幕', exact: true }).click(); await settle(page); await located();
  console.log('check', checks.length + 1); checks.push('收起移除内容，展开重新定位');
  const special = [
    { start_ms: 0, end_ms: 100, text: 'first <script> plain' },
    { start_ms: 1000, end_ms: 1200, text: 'overlap A\nsecond line' },
    { start_ms: 1000, end_ms: 1300, text: '' },
    { start_ms: 1000, end_ms: 1000, text: 'zero duration' },
    { start_ms: 24000, end_ms: 25000, text: 'last block' },
  ];
  await controller.replace(page, special); await located(); await select(5); await located();
  assert.deepEqual((await content.locator('[data-reference-current]').allTextContents()).sort(), ['overlap A\nsecond line', '（空段）', 'zero duration'].sort());
  await select(3); await located(); assert(await content.locator('[data-reference-unmatched]').isVisible());
  await select(1); await located();
  const first = content.locator('[data-reference-current]').first();
  await content.focus(); await first.evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); getSelection().removeAllRanges(); getSelection().addRange(range); });
  await page.keyboard.press('Meta+c'); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'first <script> plain');
  assert.equal(await content.locator('script').count(), 0);
  // Native selection spanning multiple mounted paragraphs remains ordinary browser text.
  await first.evaluate(node => { const end = node.parentElement.querySelector('[data-reference-row="cue-1"]'); const range = document.createRange(); range.setStart(node.firstChild, 0); range.setEnd(end.firstChild, end.firstChild.length); getSelection().removeAllRanges(); getSelection().addRange(range); });
  await page.keyboard.press('Meta+c');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert(copied.includes('first <script> plain') && copied.includes('second line'));
  await page.locator('video').evaluate(async video => { video.currentTime = 1; await video.play(); }); await settle(page);
  assert.equal(await content.locator('[data-reference-current]').filter({ hasText: 'zero duration' }).count(), 0, 'zero-length cue only matches exact point, not a later frame');
  await page.locator('video').evaluate(video => video.pause());
  // Replace a distant reading position with a much shorter collection containing a very tall first cue.
  await controller.replace(page, [
    { start_ms: 0, end_ms: 1000, text: 'wrapping '.repeat(1000) },
    { start_ms: 2000, end_ms: 3000, text: 'after tall cue' },
  ]);
  await select(9); await located();
  await browse(1); await select(1); await located();
  await controller.replace(page, [{ start_ms: 0, end_ms: 30000, text: 'replacement only' }]); await settle(page); await located();
  assert.equal(await content.locator('[data-reference-current]').textContent(), 'replacement only');
  console.log('check', checks.length + 1); checks.push('参考替换；间隙/重叠/空文本/零时长/多行/边界；纯文本原生选择复制');
  await page.screenshot({ path: join(artifacts, 'reference-scroll.png'), fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log(JSON.stringify({ artifacts, browser: browser.version(), fixture: fixture.metadata, checks, errors, unexpected }, null, 2));
  writeFileSync(join(artifacts, 'report.json'), JSON.stringify({ checks, errors, unexpected }, null, 2));
} catch (error) {
  console.error({ artifacts, errors, unexpected, reading: await referenceReading(page).catch(() => null), audio: await page.locator('.audio-timeline').evaluate(node => ({...node.dataset})), contexts: await page.evaluate(() => window.__contexts.map(c => ({state: c.state, time: c.currentTime, rate: c.sampleRate}))) });
  await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }); console.error(error); process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 3000).unref())]);
  process.exit(process.exitCode || 0);
}
