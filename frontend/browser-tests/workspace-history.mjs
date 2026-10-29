// Real Chrome events and pure Python ASS transformations; isolated HTTP/CAS fixtures.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { codec, uiDocument } from './ass-codec.mjs';
import { splitOnBackend } from './backend-split-fixture.mjs';
import { unavailableAssPreview } from './ass-preview-fixture.mjs';
import { checkHistoryProjects } from './workspace-history-projects.mjs';

const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-history-'));
const file = join(artifacts, 'tone.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=20',
  '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=20', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
const nativeModifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const errors = [], unexpected = [], exports = [];
let failImport = false;
const document = uiDocument(['Default', 'Alternate']); document.cues = [];
await context.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  if (path === '/api/ass/export') {
    exports.push(request.postDataJSON().document);
    return route.fulfill({ status: 503, json: { issues: [{ message: 'preview disabled in history fixture' }] } });
  }
  if (await unavailableAssPreview(route)) return;
  if (path === '/api/ass/styles') {
    const result = codec('styles', request.postDataJSON());
    return route.fulfill({ status: result.status, json: result.body });
  }
  if (path === '/api/ass/import') {
    if (failImport) { failImport = false; return route.fulfill({ status: 422, json: { issues: [{ message: 'fixture import failure' }] } }); }
    return route.fulfill({ json: { document } });
  }
  const fixtures = {
    '/api/auth/session': { user: { id: 1, username: 'history', is_dev: false } },
    '/api/organizations': { organizations: [] },
    '/api/me/settings': { audio_display_mode: 'spectrum', shortcut_overrides: {}, mouse_sets_cue_boundary: true },
    '/api/ass/empty': { document },
  };
  if (fixtures[path]) return route.fulfill({ json: fixtures[path] });
  unexpected.push(`${request.method()} ${path}`); await route.abort();
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(String(error)));
page.on('dialog', dialog => dialog.accept());
const stage = page.locator('.audio-stage');
const rows = page.locator('.cue-list tbody tr');
const start = page.getByRole('textbox', { name: '入点', exact: true });
const end = page.getByRole('textbox', { name: '出点', exact: true });
const text = page.getByLabel('字幕中文文本');
const main = page.locator('main.editor-workbench');
const draft = async () => [await start.inputValue(), await end.inputValue()];
const undo = async () => { await main.focus(); await page.keyboard.press('Control+z'); };
const redo = async () => { await main.focus(); await page.keyboard.press('Control+Shift+z'); };
async function click(time, button = 'left') {
  const rect = await stage.boundingBox();
  const [a, b] = await page.locator('.audio-timeline').evaluate(el => [Number(el.dataset.start), Number(el.dataset.end)]);
  await stage.click({ button, position: { x: (time - a) / (b - a) * rect.width, y: rect.height * .65 } });
}
async function dragStart(time) {
  const boundary = page.getByRole('slider', { name: /^字幕入点/ });
  const box = await boundary.boundingBox(), rect = await stage.boundingBox();
  const [a, b] = await page.locator('.audio-timeline').evaluate(el => [Number(el.dataset.start), Number(el.dataset.end)]);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(rect.x + (time - a) / (b - a) * rect.width, box.y + box.height / 2, { steps: 8 });
  return boundary;
}
try {
  await page.goto(process.env.HISTORY_URL || 'http://127.0.0.1:5189/workspace/local');
  await rows.first().waitFor();
  await page.getByLabel('导入本地视频').setInputFiles(file);
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
  await click(1); await click(4, 'right');
  const beforeDrag = await draft();
  await main.focus(); await page.keyboard.press('Meta+z'); assert.equal(await end.inputValue(), '0:00:02.00');
  await page.keyboard.press('Meta+Shift+z'); assert.deepEqual(await draft(), beforeDrag);
  await dragStart(2); await page.mouse.up();
  assert.equal(await start.inputValue(), '0:00:02.00');
  await undo(); assert.deepEqual(await draft(), beforeDrag);
  await redo(); assert.equal(await start.inputValue(), '0:00:02.00');
  // Undo during capture invalidates the gesture, including moves after restoration.
  await dragStart(2.5); await page.keyboard.press('Control+z');
  await page.mouse.move(900, 350, { steps: 4 }); await page.mouse.up();
  assert.equal(await start.inputValue(), '0:00:02.00');
  await redo(); assert.equal(await start.inputValue(), '0:00:02.50');
  for (const type of ['pointercancel', 'lostpointercapture']) {
    const before = await start.inputValue();
    const boundary = await dragStart(3);
    const after = await start.inputValue();
    await boundary.dispatchEvent(type, { pointerId: 1 });
    await page.mouse.move(1000, 350, { steps: 3 }); await page.mouse.up();
    assert.equal(await start.inputValue(), after);
    await undo(); assert.equal(await start.inputValue(), before);
  }
  const boundary = page.getByRole('slider', { name: /^字幕入点/ });
  await boundary.focus();
  const beforeArrow = await start.inputValue();
  await page.keyboard.down('ArrowRight'); await page.keyboard.down('ArrowRight'); await page.keyboard.down('ArrowRight'); await page.keyboard.up('ArrowRight');
  assert.notEqual(await start.inputValue(), beforeArrow);
  await undo(); assert.equal(await start.inputValue(), beforeArrow);
  await redo(); const afterArrow = await start.inputValue();
  await boundary.focus(); await page.keyboard.press('ArrowRight');
  await undo(); assert.equal(await start.inputValue(), afterArrow);
  await main.focus(); await page.keyboard.press('KeyS');
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.auditionPhase === 'playing');
  const videoBeforeUndo = await page.locator('video').evaluate(el => el.currentTime);
  await undo(); assert.equal(await page.locator('.audio-timeline').getAttribute('data-audition-phase'), 'idle');
  assert.equal(await page.locator('video').evaluate(el => el.currentTime), videoBeforeUndo); await redo();
  // One commit includes generated row + selection + drafts. Redo uses the same ID.
  const beforeCommit = await draft();
  await main.focus(); await page.keyboard.press('KeyG'); assert.equal(await rows.count(), 2);
  await page.waitForTimeout(160); const generatedId = exports.at(-1).cues[1].id;
  await stage.hover(); await page.mouse.wheel(0, 10000);
  const viewBeforeUndo = await page.locator('.audio-timeline').getAttribute('data-start');
  await undo(); assert.equal(await rows.count(), 1); assert.deepEqual(await draft(), beforeCommit);
  assert.equal(await page.locator('.audio-timeline').getAttribute('data-start'), viewBeforeUndo);
  assert.equal(await rows.first().getByRole('button', { name: '选择第 1 行', exact: true }).getAttribute('aria-pressed'), 'true');
  await redo(); assert.equal(await rows.count(), 2);
  await page.waitForTimeout(160); assert.equal(exports.at(-1).cues[1].id, generatedId);
  await stage.hover(); await page.mouse.wheel(0, -10000);
  await end.fill('unfinished'); await main.focus();
  const beforeDelete = await draft();
  await page.keyboard.press('Control+Delete'); assert.equal(await rows.count(), 1);
  await undo(); assert.equal(await rows.count(), 2); assert.deepEqual(await draft(), beforeDelete);
  await redo(); await page.keyboard.press('Control+Delete'); assert.equal(await rows.count(), 0);
  await undo(); assert.equal(await rows.count(), 1); await undo(); assert.equal(await rows.count(), 2);
  // Text group, timing, and style assignments restore in reverse order.
  await text.fill(''); await text.pressSequentially('hello'); await main.focus();
  await click(5); const timing = await draft();
  await page.getByLabel('字幕样式', { exact: true }).selectOption(document.styles[1].id); await main.focus();
  await click(6);
  await undo(); assert.deepEqual(await draft(), timing); assert.equal(await text.inputValue(), 'hello');
  assert.equal(await page.getByLabel('字幕样式', { exact: true }).inputValue(), document.styles[1].id);
  await undo(); assert.equal(await page.getByLabel('字幕样式', { exact: true }).inputValue(), document.styles[0].id);
  await undo(); assert.equal(await text.inputValue(), 'hello');
  await undo(); assert.equal(await text.inputValue(), '');
  await redo(); assert.equal(await text.inputValue(), 'hello');
  // Real native historyUndo/historyRedo InputEvents establish a safe workspace baseline.
  await text.focus(); await text.press('End'); await text.pressSequentially(' world');
  const nativeEvents = [];
  await page.exposeFunction('nativeHistoryInput', type => nativeEvents.push(type));
  await text.evaluate(el => el.addEventListener('input', event => { if (event.inputType.startsWith('history')) window.nativeHistoryInput(event.inputType); }));
  const nativeBefore = await text.inputValue();
  await text.press(`${nativeModifier}+z`); const nativeAfter = await text.inputValue();
  assert.notEqual(nativeAfter, nativeBefore); assert(nativeEvents.includes('historyUndo'));
  await redo(); assert.equal(await text.inputValue(), nativeAfter);
  await text.focus(); await text.press(`${nativeModifier}+Shift+z`);
  assert.equal(await text.inputValue(), nativeBefore); assert(nativeEvents.includes('historyRedo'));
  await undo(); assert.equal(await text.inputValue(), nativeBefore);
  // CDP uses Chrome's composition pipeline; no synthetic isComposing assumptions.
  const cdp = await context.newCDPSession(page);
  await text.focus(); await text.press('End');
  await cdp.send('Input.imeSetComposition', { text: 'zhong', selectionStart: 5, selectionEnd: 5 });
  await page.waitForTimeout(1100);
  await cdp.send('Input.imeSetComposition', { text: 'zhongw', selectionStart: 6, selectionEnd: 6 });
  const composingDraft = await text.inputValue();
  await page.keyboard.press('Control+z'); assert.equal(await text.inputValue(), composingDraft);
  await cdp.send('Input.insertText', { text: '中' });
  assert((await text.inputValue()).endsWith('中'));
  const imeFinal = await text.inputValue();
  await undo(); assert.equal(await text.inputValue(), nativeBefore);
  await redo(); assert.equal(await text.inputValue(), imeFinal);
  // Workspace restore replaces native stacks: native redo cannot resurrect old text.
  await undo(); await text.focus(); await text.press(`${nativeModifier}+Shift+z`); assert.equal(await text.inputValue(), nativeBefore);
  // Idle ends a typing group without requiring blur.
  await text.press('End'); await text.pressSequentially('1'); await page.waitForTimeout(1100); await text.pressSequentially('2');
  await undo(); assert.equal(await text.inputValue(), `${nativeBefore}1`);
  await undo(); assert.equal(await text.inputValue(), nativeBefore);
  // Local style transformations share whole valid document snapshots.
  await page.getByRole('button', { name: '管理样式', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByRole('button', { name: '复制当前样式', exact: true }).click();
  await modal.getByLabel('样式名称', { exact: true }).fill('History Copy');
  await modal.getByRole('button', { name: '应用到本地文档', exact: true }).click();
  await modal.getByText('样式已应用到本地文档，请及时导出。', { exact: true }).waitFor();
  await page.keyboard.press('Control+z'); // modal suppresses workspace undo
  assert.equal(await page.getByLabel('字幕样式', { exact: true }).locator('option').count(), 3);
  await modal.getByRole('button', { name: '关闭', exact: true }).click();
  await undo(); assert.equal(await page.getByLabel('字幕样式', { exact: true }).locator('option').count(), 2);
  await redo(); await page.getByLabel('字幕样式', { exact: true }).selectOption({ label: 'History Copy' });
  await undo(); await undo();
  assert.equal(await page.getByLabel('字幕样式', { exact: true }).locator('option').count(), 2);
  // Invalid commit preserves both the draft and the existing redo branch.
  await end.fill('bad'); await main.focus(); await page.keyboard.press('KeyG');
  assert.equal(await end.inputValue(), 'bad'); const count = await rows.count();
  await undo(); assert.notEqual(await end.inputValue(), 'bad'); await redo(); assert.equal(await end.inputValue(), 'bad');
  assert.equal(await rows.count(), count);
  // Import failure preserves history; successful import establishes a new baseline.
  failImport = true;
  const importFile = { name: 'test.ass', mimeType: 'text/plain', buffer: Buffer.from('fixture') };
  await page.getByLabel('导入基础 ASS').setInputFiles(importFile);
  const pending = await draft(); await page.keyboard.press('Control+z'); assert.deepEqual(await draft(), pending);
  await page.getByRole('button', { name: '替换当前字幕', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'fixture import failure' }).waitFor();
  await undo(); assert.notEqual(await end.inputValue(), 'bad');
  await page.getByLabel('导入基础 ASS').setInputFiles(importFile);
  await page.getByRole('button', { name: '替换当前字幕', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.cue-list tbody tr').length === 1);
  const importedDraft = await draft(); await undo(); assert.deepEqual(await draft(), importedDraft); assert.equal(await rows.count(), 1);
  await click(1); await undo(); await redo(); assert.equal(await start.inputValue(), '0:00:01.00');
  // Destroying the instance via reload starts fresh (no media/history recovery).
  await page.reload(); await rows.first().waitFor(); await undo(); assert.equal(await start.inputValue(), '0:00:00.00');
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  await checkHistoryProjects(browser, file, { createHash, readFileSync, splitOnBackend, uiDocument });
  console.log(JSON.stringify({ checks: ['one-step drags / cancel / lost capture / undo during drag', 'arrow repeat groups', 'atomic commit and stable UUID redo', 'delete including empty document and invalid drafts', 'text/style/timing ordering', 'real native undo/redo input events', 'real Chrome IME composition', 'local styles and modal guard', 'failed validation/import and import baseline', 'instance destruction', 'project save/split/revision/lifecycle'], artifacts }));
} catch (error) { console.error('History browser state:', await page.locator('body').innerText()); throw error; }
finally { await browser.close(); }
