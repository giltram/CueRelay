import { uiDocument } from './ass-codec.mjs';
import { unavailableAssPreview } from './ass-preview-fixture.mjs';
// UI-only fixtures: no development accounts, database writes or ASS conversion.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { sameTab } from './link-navigation.mjs';

const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-cue-table-'));
const video = join(artifacts, 'video.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=5', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', video]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [], unexpected = [];
page.on('pageerror', error => errors.push(String(error)));
try {
  const fixtures = {
    '/api/auth/session': { user: { id: 1, username: 'cue-table-fixture', is_dev: false } },
    '/api/organizations': { organizations: [] },
    '/api/me/settings': { shortcut_overrides: {}, audio_display_mode: 'spectrum' },
    '/api/ass/empty': { document: uiDocument(['Default', 'Emphasis']) },
  };
  await page.route('**/api/**', async route => {
    if (await unavailableAssPreview(route)) return;
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (request.method() === 'GET' && fixtures[path]) {
      await route.fulfill({ json: fixtures[path] });
    } else {
      unexpected.push(`${request.method()} ${path}`); await route.abort();
    }
  });
  await page.goto(`${process.env.CUE_TABLE_URL || 'http://127.0.0.1:5173'}/workspace/local`);
  const rows = page.locator('.cue-list tbody tr');
  await rows.first().waitFor();
  assert.deepEqual(await page.locator('.cue-list th').allTextContents(), ['行', '入', '出', 'CPS', 'style', '字幕文本']);
  assert.equal(await rows.first().locator('td').count(), 6);
  assert.equal(await rows.first().locator('.cps-cell').textContent(), '0');
  assert.equal(await rows.first().locator('.cue-text em').textContent(), '（empty）');
  assert.equal(await page.locator('.cue-list button[aria-label^="定位"]').count(), 0);
  const picker = page.getByRole('button', { name: '导入视频', exact: true });
  assert.equal(await picker.getAttribute('title'), null);
  assert(await page.getByLabel('导入本地视频').isHidden());
  await picker.hover();
  assert(await picker.evaluate(element => {
    const box = element.getBoundingClientRect();
    return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element;
  }));
  const canceled = page.waitForEvent('filechooser');
  await picker.click(); await (await canceled).setFiles([]);
  assert.equal(await rows.first().locator('.cue-text em').textContent(), '（empty）');

  await page.getByLabel('字幕中文文本').fill('你，好！\\N世界');
  assert.equal(await rows.first().locator('.cps-cell').textContent(), '2');
  await page.getByLabel('字幕样式', { exact: true }).selectOption({ label: 'Emphasis' });
  assert.equal(await rows.first().locator('td').nth(4).textContent(), 'Emphasis');
  await page.getByRole('textbox', { name: '出点', exact: true }).fill('0:00:04.00');
  assert.equal(await rows.first().locator('.cps-cell').textContent(), '2'); // Unapplied draft is separate.
  await page.locator('main').focus(); await page.keyboard.press('KeyG');
  assert.equal(await rows.count(), 2);
  assert.equal(await rows.first().locator('.cps-cell').textContent(), '1');
  assert.equal(await rows.nth(1).locator('.cps-cell').textContent(), '0');
  await page.getByLabel('字幕中文文本').fill('e\u0301👨‍👩‍👧‍👦👍🏽中');
  assert.equal(await rows.nth(1).locator('.cps-cell').textContent(), '2');
  // Selection remains available before a video is loaded.
  await rows.first().locator('.row-number').click();
  assert.equal(await page.getByRole('textbox', { name: '入点', exact: true }).inputValue(), '0:00:00.00');
  await rows.nth(1).locator('.cue-text').click();
  assert.equal(await page.getByRole('textbox', { name: '入点', exact: true }).inputValue(), '0:00:04.00');
  assert.equal(await page.getByRole('alert').count(), 0);
  const chosen = page.waitForEvent('filechooser');
  await picker.focus(); await page.keyboard.press('Enter');
  await (await chosen).setFiles(video);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  assert(await page.getByLabel('导入本地视频').isDisabled()); // Fixed-source protection remains.
  assert(await picker.isDisabled());
  assert.equal(await page.getByText('视频仅在本机播放，不会上传。', { exact: true }).count(), 0);

  const style = await rows.first().locator('.style-cell').boundingBox();
  const text = await rows.first().locator('td').last().boundingBox();
  assert(style.x < text.x && text.width > style.width * 2);
  const widthOf = async index => (await rows.first().locator('td').nth(index).boundingBox()).width;
  const defaults = [100, 100, 44, 88];
  const labels = ['入', '出', 'CPS', 'style'];
  const almost = (actual, expected) => assert(Math.abs(actual - expected) <= 1, `${actual} != ${expected}`);
  await page.evaluate(() => {
    window.__gridVideo = document.querySelector('video');
    window.__gridRow = document.querySelector('.cue-list tbody tr');
    window.__gridVideo.currentTime = 1;
  });
  await page.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 1) < .02);
  for (let index = 0; index < labels.length; index++) {
    almost(await widthOf(index + 1), defaults[index]);
    const handle = page.getByRole('separator', { name: `调整${labels[index]}列宽度`, exact: true });
    const box = await handle.boundingBox();
    const textWidth = await widthOf(5);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 32, box.y + box.height / 2, { steps: 4 });
    await page.mouse.up();
    almost(await widthOf(index + 1), defaults[index] + 32);
    almost(await widthOf(5), textWidth - 32);
    assert.equal(await handle.getAttribute('aria-valuenow'), String(defaults[index] + 32));
    await handle.dblclick();
    almost(await widthOf(index + 1), defaults[index]);
  }
  const resizeStyle = page.getByRole('separator', { name: '调整style列宽度', exact: true });
  await resizeStyle.focus();
  await page.keyboard.press('ArrowRight'); almost(await widthOf(4), 96);
  await page.keyboard.press('Shift+ArrowRight'); almost(await widthOf(4), 120);
  await page.keyboard.press('ArrowLeft'); almost(await widthOf(4), 112);
  await page.keyboard.press('Home'); almost(await widthOf(4), 64);
  await page.keyboard.press('ArrowLeft'); almost(await widthOf(4), 64);
  await page.keyboard.press('End'); almost(await widthOf(4), 320);
  await page.keyboard.press('ArrowRight'); almost(await widthOf(4), 320);
  await resizeStyle.dblclick();

  // Pointer capture keeps the drag working below the header; cancel/lost capture release it.
  let box = await resizeStyle.boundingBox();
  await page.mouse.move(box.x + 5, box.y + 5); await page.mouse.down();
  await page.mouse.move(box.x + 53, box.y + 100, { steps: 4 });
  almost(await widthOf(4), 136);
  await resizeStyle.dispatchEvent('pointercancel', { pointerId: 1 });
  assert.equal(await resizeStyle.getAttribute('data-resizing'), null);
  await page.mouse.move(box.x + 80, box.y + 100); almost(await widthOf(4), 136);
  await page.mouse.up(); await resizeStyle.dblclick();
  box = await resizeStyle.boundingBox();
  await page.mouse.move(box.x + 5, box.y + 5); await page.mouse.down();
  await page.mouse.move(box.x + 6, box.y + 5); // Establish native capture before releasing it.
  await resizeStyle.evaluate(element => element.releasePointerCapture(1));
  await page.mouse.move(box.x + 53, box.y + 100);
  await page.mouse.up();
  assert.equal(await resizeStyle.getAttribute('data-resizing'), null);
  almost(await widthOf(4), 89);
  await resizeStyle.dblclick();
  assert(await page.evaluate(() => document.querySelector('video') === window.__gridVideo && document.querySelector('.cue-list tbody tr') === window.__gridRow));
  almost(await page.locator('video').evaluate(element => element.currentTime), 1);
  assert.equal(await page.getByLabel('字幕中文文本').inputValue(), 'e\u0301👨‍👩‍👧‍👦👍🏽中');
  assert.equal(await page.getByRole('button', { name: '选择第 2 行', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('textbox', { name: '入点', exact: true }).inputValue(), '0:00:04.00');
  assert.equal(await page.getByRole('textbox', { name: '出点', exact: true }).inputValue(), '0:00:06.00');
  const subtitleSnapshot = await rows.allTextContents();
  const at = time => page.waitForFunction(time => {
    const video = document.querySelector('video');
    return !video.seeking && video.paused && Math.abs(video.currentTime - time) < .001 &&
      Math.abs(Number(document.querySelector('.video-progress').value) - time * 1000) < 1;
  }, time);
  // Selecting text while video is playing pauses and seeks to the applied start.
  await page.getByRole('button', { name: '播放 / 暂停', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('video').paused);
  await rows.nth(1).locator('.cue-text').click(); await at(4);
  assert.equal(await page.getByRole('button', { name: '选择第 2 行', exact: true }).getAttribute('aria-pressed'), 'true');
  // Clicking the already selected row number seeks again without autoplay.
  await page.locator('video').evaluate(video => { video.currentTime = .5; });
  await page.waitForFunction(() => !document.querySelector('video').seeking);
  await rows.nth(1).locator('.row-number').click(); await at(4);
  // Row selection also cancels an active independent audio audition.
  await page.locator('main').focus(); await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('.audio-timeline').dataset.auditionPhase === 'playing');
  await rows.first().locator('.cue-text').click(); await at(0);
  assert.equal(await page.locator('.audio-timeline').getAttribute('data-audition-phase'), 'idle');
  // G/Enter programmatic advance keeps the video still; the new behavior belongs to table selection.
  await page.keyboard.press('KeyG'); await at(0);
  assert.equal(await page.getByRole('button', { name: '选择第 2 行', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await rows.allTextContents(), subtitleSnapshot);
  assert(await page.evaluate(() => document.querySelector('video') === window.__gridVideo));
  // A cue beyond the media can still be selected; report the seek error without clipping subtitle time.
  await page.locator('main').focus(); await page.keyboard.press('KeyG');
  await rows.nth(2).locator('.row-number').click();
  assert.equal(await page.getByRole('textbox', { name: '入点', exact: true }).inputValue(), '0:00:06.00');
  assert.match(await page.getByRole('alert').innerText(), /定位点超过视频时长/);
  await at(0);
  await page.keyboard.press('Control+Delete'); // Restore the original two-row fixture.
  await rows.nth(1).locator('.cue-text').click(); await at(4);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(artifacts, `table-${width}.png`), fullPage: true });
  }
  const scroll = page.locator('.cue-list .table-scroll');
  await scroll.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  const edge = await scroll.boundingBox();
  const lastCell = await rows.first().locator('td').last().boundingBox();
  assert(lastCell.x + lastCell.width <= edge.x + edge.width + 1);
  await page.screenshot({ path: join(artifacts, 'table-390-scrolled.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await resizeStyle.focus(); await page.keyboard.press('ArrowRight');
  await page.getByLabel('字幕中文文本').fill('调整列宽后继续编辑');
  almost(await widthOf(4), 96);
  await sameTab(page.getByRole('link', { name: '项目列表', exact: true }));
  await page.getByRole('heading', { name: '项目', exact: true }).waitFor();
  await page.goBack(); await rows.first().waitFor();
  almost(await widthOf(4), 96);
  assert.equal(await page.getByLabel('字幕中文文本').inputValue(), '调整列宽后继续编辑');
  assert(await page.evaluate(() => document.querySelector('video') === window.__gridVideo));
  page.once('dialog', dialog => dialog.accept());
  await page.reload(); await rows.first().waitFor();
  almost(await widthOf(4), 88); // Widths are per-workspace memory, with no new storage.
  assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: browser.version(), rowSelectionSeeks: true, pausesVideoAndAudition: true, noMediaSelection: true, programmaticAdvanceStaysStill: true, outOfRangeSelection: true, columnOrder: true, liveCps: true, appliedTiming: true, unicode: true, tooltipRemoved: true, fixedVideo: true, resizeColumns: true, pointerCapture: true, keyboardLimits: true, resetWidths: true, preserveWorkspace: true, artifacts, errors }, null, 2));
} finally { await browser.close(); }
