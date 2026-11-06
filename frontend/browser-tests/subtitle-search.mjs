// Real Chrome interaction; isolated HTTP fixtures and generated local media only.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { uiDocument } from './ass-codec.mjs';
import { unavailableAssPreview } from './ass-preview-fixture.mjs';
import { sameTab } from './link-navigation.mjs';

const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-subtitle-search-'));
const file = join(artifacts, 'video.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
  'color=c=black:s=160x90:r=10:d=8', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const documentFixture = uiDocument();
documentFixture.cues = Array.from({ length: 32 }, (_, index) => ({
  id: `new-${index + 1}`, start_ms: (index + 1) * 100, end_ms: (index + 1) * 100 + 100,
  style_id: documentFixture.styles[0].id,
  text: [1, 15, 29].includes(index) ? '{\\b1}你{\\b0}好 你好\\NHello\\hWORLD hello' : `字幕 ${index + 1}`,
})).reverse(); // Source order deliberately differs from table order.
const project = { id: 1, organization_id: 1, name: 'Search fixture', description: '', status: 'active', revision: 1,
  updated_at: '2026-11-06T00:00:00Z', created_at: '2026-11-06T00:00:00Z', updated_by: { username: 'search' }, archived_at: null, archived_by: null,
  media: { sha256: '0'.repeat(64), size: 1, duration_ms: 8000 }, document: documentFixture };
const archived = { ...project, id: 2, status: 'archived' };
const errors = [], unexpected = [], checks = [], requests = [];
context.on('page', page => page.on('pageerror', error => errors.push(String(error))));
await context.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  requests.push(`${request.method()} ${path}`);
  if (await unavailableAssPreview(route)) return;
  const fixtures = {
    '/api/auth/session': { user: { id: 1, username: 'search', is_dev: false } },
    '/api/organizations': { organizations: [{ id: 1, name: 'Search org', role: 'member', can_manage: false }] },
    '/api/me/settings': { shortcut_overrides: { 'split-text': ['Ctrl+KeyF', 'Meta+KeyF'] }, audio_display_mode: 'spectrum', mouse_sets_cue_boundary: true },
    '/api/ass/empty': { document: documentFixture },
    '/api/organizations/1/projects/1': { project }, '/api/organizations/1/projects/2': { project: archived },
    '/api/organizations/1/projects': { projects: [project, archived], total: 2, page: 1, has_more: false },
  };
  if (request.method() === 'GET' && fixtures[path]) return route.fulfill({ json: fixtures[path] });
  if (path === '/api/ass/styles' && request.postDataJSON().operation.type === 'inspect') {
    return route.fulfill({ json: { document: documentFixture, usage: {} } });
  }
  unexpected.push(`${request.method()} ${path}`); return route.abort();
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
page.on('dialog', dialog => dialog.accept());
const main = page.locator('main.editor-workbench'), rows = page.locator('.cue-list tbody tr');
const text = page.getByLabel('字幕中文文本'), input = page.getByRole('textbox', { name: '查找字幕文本', exact: true });
const start = page.getByRole('textbox', { name: '入点', exact: true }), end = page.getByRole('textbox', { name: '出点', exact: true });
const next = page.getByRole('button', { name: '下一个', exact: true });
const previous = page.getByRole('button', { name: '上一个', exact: true });
const find = page.getByRole('button', { name: '查找字幕', exact: true });
const status = page.locator('.cue-search-status');
const focused = locator => locator.evaluate(el => el === document.activeElement);
const selected = () => page.locator('.row-number[aria-pressed="true"]').textContent();
const select = number => page.getByRole('button', { name: `选择第 ${number} 行`, exact: true }).click();
const query = async value => { await input.fill(value); await status.waitFor({ state: 'attached' }); };
const snapshot = () => page.evaluate(() => ({
  selected: document.querySelector('.row-number[aria-pressed="true"]')?.textContent,
  start: document.querySelector('[aria-label="入点"]').value, end: document.querySelector('[aria-label="出点"]').value,
  rows: [...document.querySelectorAll('.cue-text')].map(el => el.textContent),
  time: document.querySelector('video')?.currentTime, paused: document.querySelector('video')?.paused,
  audition: document.querySelector('.audio-timeline')?.dataset.auditionPhase,
  scroll: document.querySelector('.table-scroll').scrollTop,
}));
const dispatchKey = (locator, flags = {}) => locator.evaluate((el, flags) => {
  const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, ...flags });
  el.dispatchEvent(event); return event.defaultPrevented;
}, flags);
try {
  await page.goto(`${process.env.SUBTITLE_SEARCH_URL || 'http://127.0.0.1:5173'}/workspace/local`);
  await rows.first().waitFor();
  // Re-selecting a row must preserve even an unfinished time draft without media.
  await select(16); await start.fill('0:'); await end.fill('0:00:04.55');
  await select(16); await rows.nth(15).locator('.cue-text').click();
  assert.equal(await start.inputValue(), '0:'); assert.equal(await end.inputValue(), '0:00:04.55');
  await select(15); await select(16);
  assert.equal(await start.inputValue(), '0:00:01.60'); assert.equal(await end.inputValue(), '0:00:01.70');
  checks.push('without video: row number/text re-selection preserves raw draft; switching away and back discards it');
  await page.evaluate(() => document.activeElement?.blur());
  assert.equal(await find.getAttribute('aria-pressed'), 'false');
  const closedListHeight = (await page.locator('.table-scroll').boundingBox()).height;
  await page.keyboard.press('Control+f'); assert(await focused(input));
  assert.equal(await find.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('button', { name: '关闭字幕查找', exact: true }).count(), 0);
  const inputHeight = (await input.boundingBox()).height;
  const barHeight = (await page.locator('.cue-search-bar').boundingBox()).height;
  assert(inputHeight <= 28, `compact input height: ${inputHeight}`);
  assert(barHeight <= 32, `compact search bar height: ${barHeight}`);
  const openListHeight = (await page.locator('.table-scroll').boundingBox()).height;
  assert(Math.abs(closedListHeight - openListHeight - barHeight) <= 1);
  await find.click(); assert.equal(await input.count(), 0); assert(await focused(main));
  assert.equal(await find.getAttribute('aria-pressed'), 'false');
  assert.equal((await page.locator('.table-scroll').boundingBox()).height, closedListHeight);
  checks.push('find toggles its pressed state and bar; no close button; compact 28px input/32px bar leaves remaining height to subtitles');
  await select(16); await start.fill('0:'); await end.fill('0:00:04.55');
  await page.getByRole('button', { name: '查找字幕', exact: true }).click();
  assert(await focused(input)); assert.equal(await status.textContent(), '');
  const before = await snapshot(), beforeRequests = requests.length;
  await query('你好');
  assert.equal(await status.textContent(), '0 / 3 行');
  assert.deepEqual(await snapshot(), before); assert.equal(requests.length, beforeRequests);
  assert.equal(await rows.count(), 32); assert.equal(await rows.nth(1).locator('mark').count(), 3);
  assert.equal(await rows.nth(1).locator('.cue-text').textContent(), documentFixture.cues.find(cue => cue.id === 'new-2').text);
  assert.equal(await rows.nth(1).locator('mark').allTextContents().then(parts => parts.join('')), '你好你好');
  await query('hello world'); assert.equal(await status.textContent(), '0 / 3 行');
  await query('b1'); assert.equal(await status.textContent(), '无匹配');
  await query('hello');
  assert.deepEqual(await snapshot(), before);
  checks.push('typing is read-only: full time-sorted rows, raw ASS source, multiple highlights, no selection/draft/media/scroll/request changes');

  await page.keyboard.press('Enter'); assert.equal(await selected(), '16'); assert.equal(await status.textContent(), '2 / 3 行');
  assert.equal(await start.inputValue(), '0:'); assert.equal(await end.inputValue(), '0:00:04.55');
  assert(await focused(input));
  await page.keyboard.press('Enter'); assert.equal(await selected(), '30'); assert.equal(await status.textContent(), '3 / 3 行');
  assert.equal(await start.inputValue(), '0:00:03.00'); assert.equal(await end.inputValue(), '0:00:03.10');
  assert.equal(await rows.filter({ has: page.locator('.cue-text') }).count(), 32);
  assert(await rows.nth(29).evaluate(el => {
    const box = el.getBoundingClientRect(), container = el.closest('.table-scroll').getBoundingClientRect();
    return box.top >= container.top + el.closest('table').querySelector('thead').getBoundingClientRect().height - 1 && box.bottom <= container.bottom + 1;
  }));
  await next.click(); assert.equal(await selected(), '2'); assert(await focused(input));
  await previous.focus(); await page.keyboard.press('Enter'); assert.equal(await selected(), '30'); assert(await focused(input));
  await page.keyboard.press('Shift+Enter'); assert.equal(await selected(), '16');
  assert.equal(await page.locator('tr.search-current').count(), 1);
  await query('HELLO'); await page.keyboard.press('Shift+Enter'); assert.equal(await selected(), '16');
  await select(10); await query('hello'); await page.keyboard.press('Enter'); assert.equal(await selected(), '16');
  await select(10); await query('HELLO'); await page.keyboard.press('Shift+Enter'); assert.equal(await selected(), '2');
  assert.equal(await page.getByRole('alert').count(), 0);
  checks.push('no-video navigation, inclusive first next/previous, non-match selection, cycles, current row styling and nearest list scroll');

  const imeBefore = await snapshot();
  await input.dispatchEvent('compositionstart');
  assert.equal(await dispatchKey(input), false); assert.deepEqual(await snapshot(), imeBefore);
  await input.dispatchEvent('compositionend');
  for (const flags of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }]) {
    assert.equal(await dispatchKey(input, flags), false); assert.deepEqual(await snapshot(), imeBefore);
  }
  // Exercise an actual browser IME composition through Chrome's protocol too.
  const cdp = await context.newCDPSession(page);
  await input.selectText();
  await cdp.send('Input.imeSetComposition', { text: '你好', selectionStart: 2, selectionEnd: 2 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229 });
  assert.equal(await selected(), imeBefore.selected);
  await cdp.send('Input.insertText', { text: '你好' });
  await cdp.detach();
  await query(''); const blankBefore = await snapshot();
  await page.keyboard.type('qwg '); assert.equal(await input.inputValue(), 'qwg ');
  await page.keyboard.press('Enter');
  assert.deepEqual(await snapshot(), blankBefore); assert.equal(await status.textContent(), '无匹配');
  assert(await next.isDisabled()); assert(await previous.isDisabled());
  await query(''); assert.equal(await rows.locator('mark').count(), 0); assert.equal(await status.textContent(), '');
  await page.keyboard.press('Enter'); assert.deepEqual(await snapshot(), blankBefore);
  await input.press('Control+f');
  assert.deepEqual(await input.evaluate(el => [el.selectionStart, el.selectionEnd]), [0, 0]);
  await query('hello'); await input.press('Meta+f'); assert(await focused(input));
  assert.deepEqual(await input.evaluate(el => [el.selectionStart, el.selectionEnd]), [0, 5]);
  await text.focus(); await page.keyboard.press('Control+f'); assert(await focused(input));
  assert.deepEqual(await input.evaluate(el => [el.selectionStart, el.selectionEnd]), [0, 5]);
  const closingBefore = await snapshot();
  await page.keyboard.press('Escape'); assert.equal(await input.count(), 0); assert(await focused(main));
  assert.equal(await rows.locator('mark').count(), 0); assert.deepEqual(await snapshot(), closingBefore);
  await text.focus(); await page.keyboard.press('Meta+f'); assert(await focused(input));
  await find.focus(); await page.keyboard.press('Enter'); assert.equal(await input.count(), 0); assert(await focused(main));
  await page.getByRole('button', { name: '查找字幕', exact: true }).click(); await find.click(); assert(await focused(main));
  checks.push('IME flags and CDP composition, empty/no matches, timing key isolation, Ctrl/Cmd+F from textarea, repeated focus/select, Escape and find toggle close focus');

  await select(5); await text.fill('needle <img src=x onerror=alert(1)>');
  await main.focus(); await page.keyboard.press('Control+f'); await query('needle');
  assert.equal(await status.textContent(), '0 / 1 行');
  await page.keyboard.press('Enter'); assert.equal(await selected(), '5');
  await query('<img'); assert.equal(await rows.locator('.cue-text img').count(), 0); assert.equal(await status.textContent(), '0 / 1 行');
  await query('needle'); await page.keyboard.press('Enter');
  await text.fill('removed'); assert.equal(await status.textContent(), '无匹配');
  await main.focus(); await page.keyboard.press('Control+z'); assert.equal(await status.textContent(), '0 / 1 行');
  await input.focus(); await page.keyboard.press('Enter');
  await page.getByRole('button', { name: '删除选中行', exact: true }).click();
  assert.equal(await rows.count(), 31); assert.equal(await status.textContent(), '无匹配');
  await main.focus(); await page.keyboard.press('Control+z');
  assert.equal(await rows.count(), 32); assert.equal(await status.textContent(), '0 / 1 行');
  assert.equal(await text.inputValue(), 'needle <img src=x onerror=alert(1)>');
  checks.push('unsaved text edits/deletion/undo update results by cue ID; search creates no history step; HTML-like text stays inert');

  await find.click(); await page.getByLabel('导入本地视频').setInputFiles(file);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
  await select(16); await start.fill('0:00:00.33');
  await page.locator('video').evaluate(video => { video.currentTime = 5; });
  await page.waitForFunction(() => !document.querySelector('video').seeking);
  await main.focus(); await page.keyboard.press('Control+f');
  const mediaBefore = await snapshot();
  await query('hello'); assert.deepEqual(await snapshot(), mediaBefore);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const video = document.querySelector('video'); return !video.seeking && video.paused && Math.abs(video.currentTime - 1.6) < .001;
  });
  assert(await focused(input)); assert.equal(await start.inputValue(), '0:00:00.33');
  await page.getByRole('button', { name: '播放 / 暂停', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('video').paused);
  await input.focus(); await query('HELLO');
  assert.equal(await page.locator('video').evaluate(video => video.paused), false);
  await next.click(); // First result from selected row is inclusive after query change.
  await page.waitForFunction(() => { const v = document.querySelector('video'); return v.paused && !v.seeking && Math.abs(v.currentTime - 1.6) < .001; });
  const afterLocate = await snapshot(); await find.click(); assert.deepEqual(await snapshot(), afterLocate);
  checks.push('loaded video: typing retains paused position and active playback; explicit navigation pauses/seeks, adopts existing draft rules, close retains media');

  await main.focus(); await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.auditionPhase === 'playing');
  await page.keyboard.press('Control+f'); await query('hello');
  assert.equal(await page.locator('.audio-timeline').getAttribute('data-audition-phase'), 'playing');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.audio-timeline').getAttribute('data-audition-phase'), 'idle');
  assert(await focused(input)); await find.click();
  checks.push('typing keeps active independent audition; explicit search navigation cancels it through existing selection');

  // G creates a new current row; mouse timing remains a draft until the next G.
  await select(32); await main.focus(); await page.keyboard.press('KeyG');
  assert.equal(await selected(), '33');
  const stage = page.locator('.audio-stage');
  const clickTime = async (time, button) => {
    const view = await page.locator('.audio-timeline').evaluate(el => ({ start: Number(el.dataset.start), end: Number(el.dataset.end) }));
    const box = await stage.boundingBox();
    await stage.click({ button, position: { x: (time - view.start) / (view.end - view.start) * box.width, y: box.height * .65 } });
  };
  await clickTime(3.5, 'left'); await clickTime(5.6, 'right');
  const draft = [await start.inputValue(), await end.inputValue()];
  assert.deepEqual(draft, ['0:00:03.50', '0:00:05.60']);
  for (const target of [page.getByRole('button', { name: '选择第 33 行', exact: true }), rows.nth(32).locator('.cue-text')]) {
    await target.click();
    assert.deepEqual([await start.inputValue(), await end.inputValue()], draft);
    assert.deepEqual(await rows.nth(32).locator('.time-cell').allTextContents(), ['0:00:03.30', '0:00:05.30']);
  }
  await select(32); await select(33);
  assert.deepEqual([await start.inputValue(), await end.inputValue()], ['0:00:03.30', '0:00:05.30']);
  await clickTime(3.5, 'left'); await clickTime(5.6, 'right'); await select(33);
  await main.focus(); await page.keyboard.press('KeyG');
  assert.deepEqual(await rows.nth(32).locator('.time-cell').allTextContents(), draft);
  assert.equal(await selected(), '34');
  checks.push('new row with video: mouse start/end drafts survive row number/text clicks, switch discards, G commits and advances');

  await page.getByRole('button', { name: '管理样式', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '本地样式管理', exact: true }); await dialog.waitFor();
  assert.equal(await dispatchKey(dialog.getByRole('button', { name: '关闭', exact: true }), { key: 'f', code: 'KeyF', ctrlKey: true }), false);
  assert.equal(await input.count(), 0);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await main.focus(); await page.keyboard.press('Control+f'); await query('hello');
  await sameTab(page.getByRole('link', { name: '项目列表', exact: true }));
  await main.waitFor({ state: 'hidden' });
  assert.equal(await dispatchKey(page.locator('main').filter({ hasNot: page.locator('.cue-list') }), { key: 'f', code: 'KeyF', ctrlKey: true }), false);
  await page.goBack(); await main.waitFor({ state: 'visible' });
  assert.equal(await input.inputValue(), 'hello');
  checks.push('style modal and other page leave browser find untouched; retained workspace keeps only its own search state');

  for (const id of [1, 2]) {
    const view = await context.newPage();
    await view.goto(new URL(`/organizations/1/projects/${id}/workspace`, page.url()).href);
    await view.locator('.cue-list tbody tr').first().waitFor();
    const field = view.getByRole('textbox', { name: '查找字幕文本', exact: true });
    const viewMain = view.locator('main.editor-workbench');
    await viewMain.focus(); await view.keyboard.press('Control+f'); await field.fill('hello');
    assert.equal(await view.locator('.cue-search-status').textContent(), '0 / 3 行');
    const save = view.getByRole('button', { name: '保存项目', exact: true });
    if (id === 1) assert(await save.isDisabled());
    await view.keyboard.press(id === 1 ? 'Enter' : 'Shift+Enter');
    const initialRow = id === 1 ? '2' : '30';
    assert.equal(await view.locator('.row-number[aria-pressed="true"]').textContent(), initialRow);
    assert(await focused(field));
    await field.fill('HELLO'); await view.keyboard.press('Shift+Enter');
    assert.equal(await view.locator('.row-number[aria-pressed="true"]').textContent(), initialRow);
    await field.press('Escape'); await viewMain.focus(); await view.keyboard.press('Control+f');
    await field.fill('hello'); await view.keyboard.press('Shift+Enter');
    assert.equal(await view.locator('.row-number[aria-pressed="true"]').textContent(), initialRow);
    assert.equal(await view.getByRole('alert').count(), 0);
    assert(await view.getByLabel('字幕中文文本').isDisabled());
    if (id === 1) assert(await save.isDisabled());
    await view.close();
  }
  checks.push('unverified and archived read-only projects search/select without media; no selected row starts at first/last result; save stays clean');
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  await input.focus(); await page.keyboard.press('Enter');
  await page.screenshot({ path: join(artifacts, 'subtitle-search.png'), fullPage: true });
  const report = { browser: browser.version(), checks, errors, unexpected };
  writeFileSync(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ artifacts, ...report }, null, 2));
} finally { await browser.close(); }
