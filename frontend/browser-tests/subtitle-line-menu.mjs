// Real Chrome, OS clipboard permissions, real pure codec, generated MP4; no database writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { codec, uiDocument } from './ass-codec.mjs';
import { unavailableAssPreview } from './ass-preview-fixture.mjs';

const multiModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-line-menu-'));
const file = join(artifacts, 'frames.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=15',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=15', '-c:v', 'libx264', '-bf', '3', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
context.setDefaultTimeout(10000);
const fixture = uiDocument(['Default', 'Other']);
fixture.cues = [['c', 8000], ['a', 2000], ['b', 5000], ['d', 11000]].map(([id, start]) => ({
  id: `new-${id}`, start_ms: start, end_ms: start + 1000, text: id.toUpperCase(), style_id: fixture.styles[0].id,
}));
let settings = { audio_display_mode: 'spectrum', mouse_sets_cue_boundary: true, shortcut_overrides: {}, handbook_seen: true };
let saved = null, failCopy = false, delayPaste = null, orgAvailable = false, savedProject = null;
const mediaBytes = readFileSync(file), mediaSha = createHash('sha256').update(mediaBytes).digest('hex');
const requests = [], unexpected = [], errors = [], checks = [];
await context.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  requests.push(`${request.method()} ${path}`);
  if (await unavailableAssPreview(route)) return;
  if (path === '/api/ass/clipboard') {
    if (failCopy && Object.keys(request.postDataJSON()).length === 2) {
      failCopy = false; return route.fulfill({ status: 422, json: { issues: [{ message: 'fixture copy failure' }] } });
    }
    if (delayPaste && 'text' in request.postDataJSON()) await delayPaste;
    const result = codec('clipboard', request.postDataJSON());
    return route.fulfill({ status: result.status, json: result.body });
  }
  if (path === '/api/ass/styles') {
    const result = codec('styles', request.postDataJSON());
    return route.fulfill({ status: result.status, json: result.body });
  }
  if (path === '/api/ass/import') return route.fulfill({ json: { document: fixture } });
  if (path === '/api/me/settings') {
    if (request.method() === 'PATCH') { saved = request.postDataJSON(); settings = { ...settings, ...saved }; }
    return route.fulfill({ json: settings });
  }
  const project = { id: 1, organization_id: 1, name: 'Line menu project', description: '', status: 'active', revision: 1,
    created_at: '2026-11-07T00:00:00Z', updated_at: '2026-11-07T00:00:00Z', updated_by: { username: 'line-menu' },
    archived_at: null, archived_by: null, media: { sha256: '0'.repeat(64), size: 1, duration_ms: 15000 }, document: fixture };
  const verifiedProject = { ...project, id: 3, document: savedProject ?? fixture, revision: savedProject ? 2 : 1,
    media: { sha256: mediaSha, size: mediaBytes.length, duration_ms: 15000 } };
  if (path === '/api/organizations/1/projects/3/document' && request.method() === 'PUT') {
    const { document, revision } = request.postDataJSON();
    assert.equal(revision, 1); assert.equal(document.source, fixture.source);
    assert.deepEqual(document.styles, fixture.styles); assert.deepEqual(document.script, fixture.script);
    assert.equal(codec('export', { document }).status, 200);
    savedProject = document;
    return route.fulfill({ json: { project: { ...verifiedProject, revision: 2 } } });
  }
  const fixtures = {
    '/api/auth/session': { user: { id: 1, username: 'line-menu', is_dev: false } },
    '/api/organizations': { organizations: orgAvailable ? [{ id: 1, name: 'Line org', role: 'member', can_manage: false }] : [] },
    '/api/organizations/1/projects/3': { project: verifiedProject },
    '/api/organizations/1/projects/1': { project }, '/api/organizations/1/projects/2': { project: { ...project, id: 2, status: 'archived' } }, '/api/ass/empty': { document: fixture },
  };
  if (fixtures[path]) return route.fulfill({ json: fixtures[path] });
  unexpected.push(`${request.method()} ${path}`); return route.abort();
});
const page = await context.newPage(); page.setDefaultTimeout(10000);
page.on('pageerror', error => errors.push(String(error))); page.on('dialog', dialog => dialog.accept());
const rows = page.locator('.cue-list tbody tr'), main = page.locator('main.editor-workbench');
const text = page.getByLabel('字幕中文文本');
const start = page.getByRole('textbox', { name: '入点', exact: true }), end = page.getByRole('textbox', { name: '出点', exact: true });
const row = value => rows.filter({ has: page.locator('.cue-text', { hasText: new RegExp(`^${value}$`) }) });
const selected = () => page.locator('.cue-list tr[aria-selected="true"] .cue-text').allTextContents();
const count = n => page.waitForFunction(n => document.querySelectorAll('.cue-list tbody tr').length === n, n);
const undo = async () => { await main.focus(); await page.keyboard.press('Control+z'); };
const menu = async (value, name) => {
  await row(value).first().click({ button: 'right' });
  const item = page.getByRole('menuitem', { name, exact: false });
  if (name) await item.click();
};
const writeClipboard = value => page.evaluate(value => navigator.clipboard.writeText(value), value);
try {
  await page.goto(`${process.env.LINE_MENU_URL || 'http://127.0.0.1:5201'}/workspace/local`);
  await count(4);
  assert.deepEqual(await rows.locator('.cue-text').allTextContents(), ['A', 'B', 'C', 'D']);
  await row('A').click(); await start.fill('0:');
  await row('C').click({ modifiers: [multiModifier] }); assert.deepEqual(await selected(), ['A', 'C']);
  await row('B').click({ modifiers: ['Shift'] }); assert.deepEqual(await selected(), ['B', 'C']);
  await row('B').click({ button: 'right' }); assert.deepEqual(await selected(), ['B', 'C']);
  assert(await page.getByRole('menu').evaluate(el => el === document.activeElement));
  assert.equal(await page.getByRole('menuitem').evaluateAll(items => items.some(el => el === document.activeElement)), false);
  await page.keyboard.press('ArrowUp');
  assert(await page.getByRole('menuitem').last().evaluate(el => el === document.activeElement));
  await page.keyboard.press('Home');
  assert(await page.getByRole('menuitem').first().evaluate(el => el === document.activeElement));
  await page.keyboard.press('Escape'); assert(await main.evaluate(el => el === document.activeElement));
  await row('A').click(); await start.fill('0:');
  await menu('A', '重复字幕行'); await count(5);
  await undo(); await count(4); assert.equal(await start.inputValue(), '0:'); assert.deepEqual(await selected(), ['A']);
  checks.push('chronological table; Ctrl/Shift selection; right click preserves selection; undo restores raw draft and selection');

  await row('A').click(); await row('C').click({ modifiers: [multiModifier] });
  await menu('C', '复制字幕行');
  await page.waitForFunction(() => !document.body.textContent.includes('正在转换…'));
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  assert(copied.includes(',,C\r\nDialogue:')); assert(copied.endsWith(',,A'));
  await menu('C', '重复字幕行'); await count(6); assert.equal((await selected()).length, 2);
  await undo(); await count(4); assert.deepEqual(await selected(), ['A', 'C']);
  await menu('C', '删除当前字幕行'); await count(2); await undo(); await count(4);
  checks.push('native clipboard serializes ASS in document order; duplicate/delete batch and undo preserve multi-selection');

  await row('A').click();
  await menu('A', '在当前行前插入字幕'); await count(5);
  assert.equal(await start.inputValue(), '0:00:00.00'); assert.equal(await end.inputValue(), '0:00:02.00');
  await undo(); await count(4);
  await menu('A', '在当前行后插入字幕'); await count(5);
  assert.equal(await start.inputValue(), '0:00:03.00'); assert.equal(await end.inputValue(), '0:00:05.00');
  await undo(); await count(4);
  checks.push('ordinary insertion uses 3s default shortened to available nearest boundaries');

  await page.getByLabel('导入本地视频', { exact: true }).setInputFiles(file);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await row('A').click();
  await page.evaluate(() => { const v = document.querySelector('video'); v.pause(); v.currentTime = 2.55; });
  await page.waitForFunction(() => !document.querySelector('video').seeking);
  const time = await page.locator('video').evaluate(v => v.currentTime);
  await menu('A', '在当前帧前分割字幕行'); await count(5);
  assert.equal(await start.inputValue(), '0:00:02.50'); assert.equal(await end.inputValue(), '0:00:03.00');
  assert.equal(await page.locator('video').evaluate(v => v.currentTime), time);
  await undo(); await count(4);
  await menu('A', '在当前帧后分割字幕行'); await count(5);
  assert.equal(await start.inputValue(), '0:00:02.60'); await undo(); await count(4);
  await menu('A', '在当前行前按视频时间插入'); await count(5);
  assert.equal(await start.inputValue(), '0:00:02.50'); assert.equal(await end.inputValue(), '0:00:05.50'); await undo(); await count(4);
  await menu('A', '在当前行后按视频时间插入'); await count(5); await undo(); await count(4);
  checks.push('actual 10fps B-frame media; frame-before/after have distinct boundaries; video inserts keep playhead and 3s duration');

  await row('B').click(); await writeClipboard(copied);
  await main.focus(); await page.keyboard.press('Control+v'); await count(6);
  await undo(); await count(4);
  await row('A').click(); await row('C').click({ modifiers: [multiModifier] });
  await start.fill('0:');
  await writeClipboard('first\nsecond');
  await main.focus(); await page.keyboard.press('Control+Shift+v');
  const dialog = page.getByRole('dialog', { name: '选择字段粘贴覆盖字幕行' }); await dialog.waitFor();
  assert.equal(await dialog.getByRole('checkbox', { checked: true }).count(), 1);
  await dialog.getByRole('button', { name: '粘贴覆盖', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
  assert.deepEqual(await rows.locator('.cue-text').allTextContents(), ['second', 'B', 'first', 'D']);
  assert.equal(await start.inputValue(), '0:');
  assert.equal(await page.locator('.row-number[aria-pressed="true"]').textContent(), '3');
  await undo(); assert.deepEqual(await selected(), ['A', 'C']);
  await row('A').click(); await writeClipboard('Dialogue: 0,0:00:09.00,0:00:10.00,Default,,0,0,0,,replacement');
  await main.focus(); await page.keyboard.press('Control+Shift+v'); await dialog.waitFor();
  await dialog.getByRole('checkbox', { name: '入点', exact: true }).check();
  await dialog.getByRole('button', { name: '粘贴覆盖', exact: true }).click();
  await dialog.getByRole('alert').waitFor(); assert.equal(await row('A').count(), 1);
  await dialog.getByRole('checkbox', { name: '出点', exact: true }).check();
  await dialog.getByRole('checkbox', { name: '样式', exact: true }).check();
  await dialog.getByRole('button', { name: '粘贴覆盖', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
  assert.equal(await start.inputValue(), '0:00:09.00'); assert.equal(await end.inputValue(), '0:00:10.00'); await undo();
  checks.push('paste/over use OS clipboard; selected-field overwrite, document-order batching, invalid interval rejection and retry');
  await text.fill('A-edit'); await main.focus(); await writeClipboard('A-edit');
  await page.keyboard.press('Control+Shift+v'); await dialog.waitFor();
  await dialog.getByRole('button', { name: '粘贴覆盖', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
  await undo(); assert.equal(await text.inputValue(), 'A');
  checks.push('text-only overwrite preserves raw timing draft and active selection; no-op overwrite adds no undo step');


  await row('A').click(); failCopy = true;
  await menu('A', '剪切字幕行'); await page.getByRole('alert').filter({ hasText: 'fixture copy failure' }).waitFor();
  await count(4); assert.deepEqual(await selected(), ['A']);
  await menu('A', '剪切字幕行'); await count(3); await undo(); await count(4);
  await text.fill('native text'); await text.focus(); await text.press('Control+a'); await text.press('Control+c'); await count(4);
  await undo();
  checks.push('failed copy cannot cut; successful cut is undoable; text input retains native clipboard behavior');

  await row('A').click();
  await page.evaluate(() => {
    window.originalClipboardWrite = navigator.clipboard.write.bind(navigator.clipboard);
    navigator.clipboard.write = () => Promise.reject(new DOMException('fixture permission denied', 'NotAllowedError'));
  });
  await menu('A', '剪切字幕行');
  await page.getByRole('alert').filter({ hasText: 'fixture permission denied' }).waitFor(); await count(4);
  await page.evaluate(() => { navigator.clipboard.write = window.originalClipboardWrite; });
  checks.push('browser clipboard permission denial leaves every selected line intact');

  await row('A').click(); await row('D').click({ modifiers: ['Shift'] });
  await menu('D', '删除当前字幕行'); await count(0);
  await writeClipboard('empty paste'); await main.focus(); await page.keyboard.press('Control+v'); await count(1);
  assert.equal(await rows.locator('.cue-text').textContent(), 'empty paste');
  await undo(); await count(0); await undo(); await count(4);
  checks.push('delete-all and paste into an empty document are both undoable');

  await row('A').click(); await writeClipboard('late paste');
  let release;
  delayPaste = new Promise(resolve => { release = resolve; });
  const pendingRequest = page.waitForRequest(request => request.url().endsWith('/api/ass/clipboard') && request.postDataJSON().text === 'late paste');
  await main.focus(); await page.keyboard.press('Control+v'); await pendingRequest;
  await page.getByRole('link', { name: 'CueRelay', exact: true }).click();
  const pasteResponse = page.waitForResponse(response => response.url().endsWith('/api/ass/clipboard'));
  release(); delayPaste = null; await pasteResponse;
  await page.goBack(); await count(4); assert.equal(await row('late paste').count(), 0);
  checks.push('a clipboard response completing while the workspace is hidden cannot mutate the document');

  const preferences = await context.newPage();
  await preferences.goto(`${process.env.LINE_MENU_URL || 'http://127.0.0.1:5201'}/settings`);
  await preferences.getByRole('textbox', { name: '在当前行前插入字幕绑定', exact: true }).fill('Alt+KeyI');
  await preferences.getByRole('button', { name: '保存快捷键', exact: true }).click();
  await preferences.waitForFunction(() => document.body.textContent.includes('已保存'));
  assert.deepEqual(saved.shortcut_overrides['insert-before'], ['Alt+KeyI']);
  await preferences.reload();
  assert.equal(await preferences.getByRole('textbox', { name: '在当前行前插入字幕绑定', exact: true }).inputValue(), 'Alt+KeyI');
  await preferences.close(); await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await row('A').click(); await main.focus();
  await page.waitForTimeout(150); await page.keyboard.press('Alt+i'); await count(5); await undo(); await count(4);
  checks.push('settings custom binding saves/reloads and applies to the existing workspace');

  await row('A').locator('.row-number').focus(); await page.keyboard.press('Shift+F10');
  await page.getByRole('menu', { name: '字幕行操作' }).waitFor();
  assert(await page.getByRole('menuitem').first().evaluate(el => el === document.activeElement));
  await page.keyboard.press('End'); assert.equal(await page.evaluate(() => document.activeElement.textContent.includes('删除当前字幕行')), true);
  await page.keyboard.press('Escape');
  await page.screenshot({ path: join(artifacts, 'workspace.png'), fullPage: true });
  await row('A').click({ button: 'right' });
  const box = await page.getByRole('menu').boundingBox(); assert(box.y >= 0 && box.y + box.height <= 1000);
  await page.screenshot({ path: join(artifacts, 'menu.png'), fullPage: true });
  checks.push('keyboard context menu, arrow/Home/End navigation, Escape focus and viewport clamping');
  await page.keyboard.press('Escape');
  orgAvailable = true;
  for (const id of [1, 2]) {
    const readonly = await context.newPage(); readonly.on('pageerror', error => errors.push(String(error)));
    await readonly.goto(`${process.env.LINE_MENU_URL || 'http://127.0.0.1:5201'}/organizations/1/projects/${id}/workspace`);
    const target = readonly.locator('.cue-list tbody tr').first(); await target.waitFor();
    await target.click({ button: 'right' });
    const copy = readonly.getByRole('menuitem', { name: '复制字幕行' });
    assert.equal(await copy.isEnabled(), true);
    assert.equal(await readonly.getByRole('menuitem').count(), 12);
    assert.equal(await readonly.getByRole('menuitem').evaluateAll(items => items.filter(el => el.disabled).length), 11);
    await copy.click();
    await readonly.waitForFunction(() => !document.body.textContent.includes('正在转换…'));
    assert((await readonly.evaluate(() => navigator.clipboard.readText())).includes(',,A'));
    await readonly.close();
  }
  checks.push('unverified and archived projects can copy; every mutation remains disabled');
  const verified = await context.newPage(); verified.on('pageerror', error => errors.push(String(error))); verified.on('dialog', dialog => dialog.accept());
  await verified.goto(`${process.env.LINE_MENU_URL || 'http://127.0.0.1:5201'}/organizations/1/projects/3/workspace`);
  await verified.getByLabel('导入本地视频', { exact: true }).setInputFiles(file);
  await verified.waitForFunction(() => !document.querySelector('.cue-editor fieldset')?.disabled);
  await verified.locator('.cue-list tbody tr').first().click();
  await verified.evaluate(() => navigator.clipboard.writeText('Dialogue: 3,0:00:04.00,0:00:04.80,Default,clipboard actor,0010,0020,0030,,saved paste'));
  await verified.locator('main.editor-workbench').focus(); await verified.keyboard.press('Control+v');
  await verified.waitForFunction(() => document.querySelectorAll('.cue-list tbody tr').length === 5);
  await verified.getByRole('button', { name: '保存项目', exact: true }).click();
  await verified.waitForFunction(() => document.body.textContent.includes('项目已保存。'));
  assert.equal(savedProject.cues.length, 5);
  assert(codec('export', { document: savedProject }).body.text.includes('3,0:00:04.00,0:00:04.80,Default,clipboard actor,0010,0020,0030,,saved paste'));
  await verified.reload();
  await verified.locator('.cue-text', { hasText: 'saved paste' }).waitFor();
  await verified.close();
  checks.push('verified project pastes preserve immutable template/styles/script, pass real codec export, and save/reload with hidden ASS metadata');


  assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, artifacts, requests: requests.length }, null, 2));
} catch (error) { console.error('Completed line checks:', checks, error); throw error; } finally { await browser.close(); }
