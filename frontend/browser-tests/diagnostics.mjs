// Real Chrome IndexedDB, download, IME and account fences; HTTP business state is isolated.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { uiDocument } from './ass-codec.mjs';
const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-diagnostics-'));
const file = join(artifacts, 'private-media-name.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
// Exercise the authoritative IndexedDB fence without the optional notification channel.
await context.addInitScript(() => { Object.defineProperty(window, 'BroadcastChannel', { value: undefined }); });
let user = { id: 1, username: 'diagnostic', is_dev: false }, conflict = false, disconnected = false;
const requests = [];
const document = uiDocument(['Default']);
const project = { id: 7, organization_id: 1, name: 'fixture', description: '', status: 'active', revision: 3,
  media: { size: readFileSync(file).length, sha256: 'private-media-digest', duration_ms: 4000 }, document };
await context.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  requests.push({ path, requestId: request.headers()['x-request-id'] });
  if (disconnected) return route.abort('internetdisconnected');
  if (path === '/api/ass/export') return route.fulfill({ status: 503, json: { issues: [{ message: 'test-only preview failure password=private-error' }] } });
  if (path === '/api/auth/login') return route.fulfill({ json: { user } });
  if (path === '/api/auth/logout') { user = null; return route.fulfill({ json: {} }); }
  if (path.endsWith('/document')) return route.fulfill({ status: conflict ? 409 : 200, json: conflict ? { error: { code: 'revision_conflict', message: 'fixture conflict' } } : { project: { ...project, revision: 4 } } });
  const fixtures = {
    '/api/auth/session': { user }, '/api/organizations': { organizations: [{ id: 1, name: 'org', role: 'organizer', can_manage: true }] },
    '/api/me/settings': { audio_display_mode: 'spectrum', shortcut_overrides: {}, mouse_sets_cue_boundary: true },
    '/api/ass/empty': { document }, '/api/organizations/1/projects/7': { project },
  };
  if (fixtures[path]) return route.fulfill({ json: fixtures[path] });
  throw new Error(`unexpected HTTP ${path}`);
});
const page = await context.newPage(), errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('dialog', dialog => dialog.accept());
const origin = process.env.DIAGNOSTICS_URL || 'http://127.0.0.1:5194';
async function report(target = page) {
  const download = target.waitForEvent('download');
  await target.getByRole('button', { name: '导出诊断信息', exact: true }).click();
  const result = await download;
  const text = readFileSync(await result.path(), 'utf8');
  assert.ok(text.includes('\n  "summary"')); return JSON.parse(text);
}
const collect = target => target.evaluate(async () => (await import('/src/diagnostics/export.ts')).diagnosticReport());
try {
  await page.goto(`${origin}/organizations/1/workspace/local`);
  const text = page.getByLabel('字幕中文文本'), main = page.locator('main.editor-workbench');
  await text.waitFor(); await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  await text.fill(''); await text.pressSequentially('continuous');
  await main.focus();
  let first = await report();
  assert.ok(first.events.some(event => event.module === 'editor' && event.data.after?.text === 'continuous'));
  assert.equal(first.environment.workspace.unsaved, true);
  await page.screenshot({ path: join(artifacts, 'diagnostics-toolbar.png') });
  await main.focus(); await page.keyboard.press('Control+z'); assert.equal(await text.inputValue(), '');
  await page.keyboard.press('Control+Shift+z'); assert.equal(await text.inputValue(), 'continuous');
  await text.focus();
  const cdp = await context.newCDPSession(page);
  await text.selectText(); await cdp.send('Input.imeSetComposition', { text: '中', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.insertText', { text: '中文输入' });
  first = await report();
  assert.ok(first.events.some(event => event.data.after?.text === '中文输入'));
  // Export did not replace the document or history; one workspace undo restores previous field.
  await main.focus(); await page.keyboard.press('Control+z'); assert.equal(await text.inputValue(), 'continuous');
  await page.keyboard.press('Control+Shift+z'); assert.equal(await text.inputValue(), '中文输入');
  await text.fill('粘贴\\N末行');
  const inputBefore = await text.inputValue();
  const pending = await page.evaluate(async () => (await import('/src/diagnostics/export.ts')).diagnosticReport());
  assert.ok(pending.events.some(event => event.data.after?.text === '粘贴\\N末行'));
  assert.equal(await text.inputValue(), inputBefore);
  // Real Worker reports no audio track for this generated video; both handled and context records survive.
  await page.getByLabel('导入本地视频').setInputFiles(file);
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'error');
  const withAudioError = await report();
  assert.ok(withAudioError.events.some(event => event.module === 'audio-analysis' && event.outcome === 'error'));
  assert.ok(!JSON.stringify(withAudioError).includes('private-media-name'));
  assert.ok(!JSON.stringify(withAudioError).includes('private-error'));
  await page.locator('video').evaluate(video => video.play());
  await report(); assert.equal(await page.locator('video').evaluate(video => video.paused), false);
  await page.locator('video').evaluate(video => video.pause());
  // Quota/write failure still permits readonly identity verification and memory export.
  await page.evaluate(() => {
    window.diagnosticOriginalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(names, mode, ...args) {
      if (mode === 'readwrite') throw new DOMException('test quota', 'QuotaExceededError');
      return window.diagnosticOriginalTransaction.call(this, names, mode, ...args);
    };
  });
  await text.fill('quota-memory-text');
  const quota = await report();
  assert.equal(quota.metadata.coverage.storage, 'memory_fallback');
  assert.ok(quota.events.some(event => event.data.after?.text === 'quota-memory-text'));
  await page.evaluate(() => { IDBDatabase.prototype.transaction = window.diagnosticOriginalTransaction; });
  // A failed download retains records and exposes a retryable, concise message.
  await page.evaluate(() => {
    window.diagnosticOriginalCreateURL = URL.createObjectURL;
    URL.createObjectURL = () => { throw Error('test download failure'); };
  });
  await page.getByRole('button', { name: '导出诊断信息', exact: true }).click();
  await page.getByText('诊断信息导出失败，请重试。', { exact: true }).waitFor();
  await page.evaluate(() => { URL.createObjectURL = window.diagnosticOriginalCreateURL; });
  assert.ok((await report()).events.some(event => event.data.after?.text === 'quota-memory-text'));

  // Same browser client used by projects; preserve lost-response ambiguity.
  conflict = true;
  await page.evaluate(async () => {
    const { createAccountApi } = await import('/src/account-ui/api.ts');
    const client = createAccountApi(() => {}); client.expectUser(1);
    await client.request('/organizations/1/projects/7/document', 'PUT', { revision: 3, password: 'private-password', lease_token: 'private-lease' }).catch(() => {});
  });
  const conflicts = (await report()).events.filter(event => event.outcome === 'conflict');
  assert.ok(conflicts.some(event => event.data.status === 409 && event.data.requestId));
  const request = conflicts.at(-1).data.requestId;
  assert.ok(requests.some(item => item.requestId === request));
  assert.ok((await collect(page)).events.some(event => event.data.requestId === request && event.outcome === 'start'));
  disconnected = true;
  await page.evaluate(async () => {
    const { diagnosticFetch } = await import('/src/diagnostics/http.ts');
    await diagnosticFetch('/api/organizations/1/projects/7/document', { method: 'PUT' }).catch(() => {});
  });
  const offline = await report();
  assert.ok(offline.events.some(event => event.outcome === 'unknown' && event.data.reason === 'no_response_result_unknown'));
  assert.equal(offline.environment.network.serverReachability, 'unknown');
  assert.ok(offline.summary.recentIssues.some(issue => issue.includes('结果未知')));
  assert.equal(offline.environment.workspace.unsaved, true);
  disconnected = false;
  await page.reload(); await text.waitFor();
  const refreshed = await report();
  assert.ok(refreshed.events.some(event => event.data.after?.text === '粘贴\\N末行'));
  assert.notEqual(refreshed.metadata.source.sessionId, offline.metadata.source.sessionId);
  // New tab observes a different account; old tab cannot export residual text or workspace state.
  user = { id: 2, username: 'other', is_dev: false };
  const second = await context.newPage(); await second.goto(`${origin}/organizations/1/workspace/local`);
  await second.getByLabel('字幕中文文本').waitFor();
  const isolated = await collect(page);
  assert.ok(!JSON.stringify(isolated).includes('粘贴'));
  assert.equal(isolated.environment.workspace, null);
  assert.ok(!JSON.stringify(await collect(second)).includes('中文输入'));
  // Count/byte retention exercised against real IDB, then checked from a new recorder (refresh equivalent).
  const budget = await second.evaluate(async () => {
    const { diagnostics } = await import('/src/diagnostics/index.ts');
    for (let index = 0; index < 1800; index++) diagnostics.record('test', 'budget', 'success', { count: index });
    return diagnostics.collect();
  });
  assert.ok(budget.events.length <= 1500); assert.ok(budget.coverage.evicted > 0);
  const persistedBudget = await second.evaluate(async () => {
    const { DiagnosticRecorder } = await import('/src/diagnostics/recorder.ts');
    const { IndexedDiagnosticStorage } = await import('/src/diagnostics/storage.ts');
    const refreshed = new DiagnosticRecorder(new IndexedDiagnosticStorage()); await refreshed.identify(2);
    refreshed.setContext({ page: 'local', organizationId: 1 }); return refreshed.collect();
  });
  assert.ok(persistedBudget.events.length <= 1500);
  assert.ok(persistedBudget.events.some(event => event.module === 'test' && event.data.count === 1799));

  // IndexedDB denied: actual editor still works and offline JSON download still succeeds.
  const fallback = await browser.newContext({ acceptDownloads: true });
  await fallback.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { get() { throw new Error('denied'); } }); });
  await fallback.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return route.fulfill({ json: { user } });
    if (path === '/api/organizations') return route.fulfill({ json: { organizations: [] } });
    if (path === '/api/me/settings') return route.fulfill({ json: { audio_display_mode: 'spectrum', shortcut_overrides: {}, mouse_sets_cue_boundary: true } });
    if (path === '/api/ass/empty') return route.fulfill({ json: { document } });
    if (path === '/api/ass/export') return route.fulfill({ status: 503, json: {} });
    return route.abort();
  });
  const denied = await fallback.newPage(); await denied.goto(`${origin}/workspace/local`);
  await denied.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  await denied.getByLabel('字幕中文文本').fill('memory fallback subtitle');
  const fallbackReport = await report(denied);
  assert.equal(fallbackReport.metadata.coverage.storage, 'memory_fallback');
  assert.ok(fallbackReport.events.some(event => event.data.after?.text === 'memory fallback subtitle'));
  assert.equal(await denied.getByLabel('字幕中文文本').inputValue(), 'memory fallback subtitle');
  await fallback.close();
  // An indefinitely pending initial session cannot hide the offline export entry.
  const waiting = await context.newPage();
  let held;
  await waiting.route('**/api/auth/session', route => { held = route; });
  await waiting.goto(`${origin}/workspace/local`);
  await waiting.getByText('正在检查会话…', { exact: true }).waitFor();
  const initializing = await report(waiting);
  assert.ok(initializing.events.some(event => event.module === 'http' && event.outcome === 'start'));
  await held?.abort(); await waiting.close();
  assert.deepEqual(errors, []);
  for (const secret of ['private-password', 'private-lease', 'private-media-digest', 'private-error']) assert.ok(!JSON.stringify(offline).includes(secret));
  console.log('diagnostics browser checks passed', artifacts);
} finally { await browser.close(); }
