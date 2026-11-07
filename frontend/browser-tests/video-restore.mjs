// Real Chrome/IndexedDB/serializable OPFS handles; OS picker and permission decisions are simulated.
// HTTP fixtures and generated media only; no development accounts or database writes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { uiDocument } from './ass-codec.mjs';
import { unavailableAssPreview } from './ass-preview-fixture.mjs';

const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-video-restore-'));
const file = join(artifacts, 'video.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
  'testsrc2=size=160x90:rate=10:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
const bytes = readFileSync(file);
const project = { id: 1, organization_id: 1, name: 'Video restore', description: '', status: 'active', revision: 1,
  updated_at: '2026-11-07T00:00:00Z', created_at: '2026-11-07T00:00:00Z', updated_by: { username: 'restore' },
  archived_at: null, archived_by: null, document: uiDocument(),
  media: { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, duration_ms: 3000 } };
project.document.cues = [{ id: 'new-restore', start_ms: 0, end_ms: 2000, style_id: project.document.styles[0].id, text: '恢复验证' }];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const baseURL = process.env.VIDEO_RESTORE_URL || 'http://127.0.0.1:5204';
const errors = [], unexpected = [], checks = [];
let actorId = 1, media = project.media;
context.on('page', page => {
  page.on('pageerror', error => errors.push(String(error)));
  page.on('dialog', dialog => dialog.accept());
  page.setDefaultTimeout(12000);
});
await context.addInitScript(() => {
  if (!window.FileSystemFileHandle) return; // Initial about:blank is not a secure origin.
  window.__hashes = 0;
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(url, options);
      this.hashWorker = String(url).includes('file-hash.worker');
      if (this.hashWorker) window.__hashes++;
    }
    postMessage(...args) {
      if (this.hashWorker && sessionStorage.getItem('delayHash')) setTimeout(() => super.postMessage(...args), 1200);
      else super.postMessage(...args);
    }
  };
  const nativeRead = FileSystemFileHandle.prototype.getFile;
  FileSystemFileHandle.prototype.getFile = async function () {
    if (sessionStorage.getItem('delayRead')) await new Promise(resolve => setTimeout(resolve, 1200));
    if (sessionStorage.getItem('missingFile')) throw new DOMException('missing', 'NotFoundError');
    return nativeRead.call(this);
  };
  FileSystemFileHandle.prototype.queryPermission = async () => sessionStorage.getItem('permission') || 'granted';
  FileSystemFileHandle.prototype.requestPermission = async options => {
    if (options.mode !== 'read') throw new Error('Unexpected write permission');
    window.__permissionGesture = navigator.userActivation.isActive;
    const permission = sessionStorage.getItem('denyPermission') ? 'denied' : 'granted';
    sessionStorage.setItem('permission', permission);
    return permission;
  };
  window.showOpenFilePicker = async () => {
    if (sessionStorage.getItem('pickerError')) throw new DOMException('blocked', 'SecurityError');
    if (sessionStorage.getItem('cancelPicker')) throw new DOMException('cancel', 'AbortError');
    const root = await navigator.storage.getDirectory();
    return [await root.getFileHandle('video.mp4')];
  };
  if (sessionStorage.getItem('unsupported')) window.showOpenFilePicker = undefined;
  if (sessionStorage.getItem('storageError')) indexedDB.open = () => { throw new DOMException('blocked', 'SecurityError'); };
});
await context.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  if (await unavailableAssPreview(route)) return;
  const fixtures = {
    '/api/auth/session': { user: { id: actorId, username: `restore-${actorId}`, is_dev: false } },
    '/api/organizations': { organizations: [{ id: 1, name: 'Restore org', role: 'organizer', can_manage: true }] },
    '/api/me/settings': { handbook_seen: true, shortcut_overrides: {}, audio_display_mode: 'spectrum', mouse_sets_cue_boundary: true },
    '/api/ass/empty': { document: project.document },
    '/api/organizations/1/projects': { projects: [project], total: 1, page: 1, has_more: false },
  };
  const match = path.match(/^\/api\/organizations\/(\d+)\/projects\/(\d+)$/);
  if (request.method() === 'GET' && match) return route.fulfill({ json: { project: { ...project, media, organization_id: Number(match[1]), id: Number(match[2]) } } });
  if (request.method() === 'GET' && fixtures[path]) return route.fulfill({ json: fixtures[path] });
  if (request.method() === 'POST' && path === '/api/organizations/1/projects') {
    const body = request.postDataJSON();
    assert.deepEqual(Object.keys(body.media).sort(), ['duration_ms', 'sha256', 'size']);
    assert(!('file' in body) && !('handle' in body));
    return route.fulfill({ json: { project: { ...project, id: 3, media: body.media, name: body.name } } });
  }
  unexpected.push(`${request.method()} ${path}`); return route.abort();
});
const page = await context.newPage();
const text = page.getByLabel('字幕中文文本');
const open = (projectId = 1, organizationId = 1) => page.goto(`${baseURL}/organizations/${organizationId}/projects/${projectId}/workspace`);
const selectRow = () => page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
const ready = async () => {
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1 && document.querySelector('.file-picker')?.disabled);
  await selectRow(); assert(await text.isEnabled());
};
const empty = async () => {
  await page.getByRole('button', { name: '导入视频', exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.file-picker')?.disabled);
  assert(await page.getByRole('textbox', { name: '入点', exact: true }).isDisabled());
  assert.equal(await page.locator('video').getAttribute('src'), null);
};
const key = `1:1:1:${media.sha256}:${media.size}`;
const waitStored = async storageKey => page.waitForFunction(async storageKey => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('cuerelay-local-video', 1);
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise(resolve => {
      const request = db.transaction('handles').objectStore('handles').get(storageKey);
      request.onsuccess = () => resolve(Boolean(request.result));
    });
  } finally { db.close(); }
}, storageKey);
const resetFile = async changed => page.evaluate(async ({ base64, changed }) => {
  const root = await navigator.storage.getDirectory(), handle = await root.getFileHandle('video.mp4', { create: true });
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0));
  if (changed) bytes[bytes.length - 1] ^= 1;
  const writer = await handle.createWritable(); await writer.write(bytes); await writer.close();
}, { base64: bytes.toString('base64'), changed });

try {
  await open(); await empty(); await resetFile(false);
  await page.evaluate(() => sessionStorage.setItem('cancelPicker', 'yes'));
  await page.getByRole('button', { name: '导入视频', exact: true }).click(); await empty();
  await page.evaluate(() => sessionStorage.removeItem('cancelPicker'));
  await page.getByRole('button', { name: '导入视频', exact: true }).click(); await ready(); await waitStored(key);
  assert.equal(await page.evaluate(() => window.__hashes), 1);
  await page.reload(); await ready();
  assert.equal(await page.evaluate(() => window.__hashes), 1);
  assert(await page.locator('video').evaluate(video => video.paused));
  checks.push('picker cancellation preserves state; successful import stores a real handle; refresh hashes again and restores paused video/editing');

  await page.evaluate(() => sessionStorage.setItem('permission', 'prompt'));
  await page.reload(); await empty();
  assert.equal(await page.evaluate(() => window.__hashes), 0);
  await page.evaluate(() => sessionStorage.setItem('denyPermission', 'yes'));
  await page.getByRole('button', { name: '重新授权视频', exact: true }).click(); await empty();
  assert(await page.getByRole('button', { name: '重新授权视频', exact: true }).isVisible());
  await page.evaluate(() => sessionStorage.removeItem('denyPermission'));
  await page.getByRole('button', { name: '重新授权视频', exact: true }).click(); await ready();
  assert.equal(await page.evaluate(() => window.__permissionGesture), true);
  checks.push('missing/denied permission never reads or enables editing; read-only reauthorization runs from a real click and validates');

  await resetFile(true); await page.reload(); await empty();
  await page.getByText('片源 SHA-256 与项目基准不一致，字幕未被修改。', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__hashes), 1);
  await resetFile(false);
  await page.evaluate(() => sessionStorage.setItem('missingFile', 'yes'));
  await page.reload(); await empty();
  await page.getByText(/无法读取上次的视频/).waitFor();
  await page.evaluate(() => { sessionStorage.removeItem('missingFile'); sessionStorage.setItem('delayRead', 'yes'); });
  await page.reload();
  await page.getByRole('button', { name: '取消校验', exact: true }).click();
  await empty(); await page.waitForTimeout(1400); await empty();
  await page.getByLabel('导入本地视频').setInputFiles(file); await ready();
  assert.equal(await page.evaluate(() => window.__hashes), 1);
  await page.evaluate(() => sessionStorage.removeItem('delayRead'));
  checks.push('same-size content changes rejected by full SHA-256; missing file falls back; cancellation ignores late read and permits manual import');

  // Fallback selection removed the previous saved handle; choose it again for isolation checks.
  await page.reload(); await empty();
  await page.getByRole('button', { name: '导入视频', exact: true }).click(); await ready(); await waitStored(key);
  await page.evaluate(() => sessionStorage.setItem('delayHash', 'yes'));
  await page.reload();
  await page.waitForFunction(() => window.__hashes === 1);
  assert(await page.getByRole('textbox', { name: '入点', exact: true }).isDisabled());
  await page.getByRole('button', { name: '取消校验', exact: true }).click();
  await page.waitForTimeout(1400); await empty();
  await page.evaluate(() => sessionStorage.removeItem('delayHash'));
  checks.push('editing remains disabled while hashing; cancel terminates verification and ignores delayed worker work');
  await open(2); await empty(); assert.equal(await page.evaluate(() => window.__hashes), 0);
  await open(1, 2); await empty(); assert.equal(await page.evaluate(() => window.__hashes), 0);
  actorId = 2; await open(); await empty(); assert.equal(await page.evaluate(() => window.__hashes), 0);
  actorId = 1; media = { ...media, sha256: '0'.repeat(64) }; await page.reload(); await empty();
  media = project.media;
  checks.push('fallback selection clears stale handle; actor, organization, project and media identity are isolated');

  await page.goto(`${baseURL}/organizations/1/projects`);
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByLabel('项目名称', { exact: true }).fill('Created with handle');
  await page.getByRole('button', { name: '选择基准视频', exact: true }).click();
  await page.getByText(/完整校验通过/).waitFor();
  await page.getByRole('button', { name: '创建并打开', exact: true }).click();
  await page.waitForURL('**/projects/3/workspace'); await ready();
  await waitStored(`1:1:3:${media.sha256}:${media.size}`);
  await page.reload(); await ready();
  await page.screenshot({ path: join(artifacts, 'restored.png') });
  checks.push('creation passes File/handle explicitly, sends only media manifest, and restores after refresh');

  await page.evaluate(() => sessionStorage.setItem('unsupported', 'yes'));
  await open(2); await empty();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入视频', exact: true }).click(); await (await chooser).setFiles(file);
  await ready(); await page.reload(); await empty();
  await page.evaluate(() => { sessionStorage.removeItem('unsupported'); sessionStorage.setItem('pickerError', 'yes'); });
  await page.reload(); await empty();
  await page.getByRole('button', { name: '导入视频', exact: true }).click();
  await page.getByText('无法记住视频文件，请再次点击并使用普通文件选择。', { exact: true }).waitFor();
  const fallback = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '导入视频', exact: true }).click(); await (await fallback).setFiles(file); await ready();
  await page.evaluate(() => { sessionStorage.removeItem('pickerError'); sessionStorage.setItem('storageError', 'yes'); });
  await page.reload(); await empty();
  await page.getByRole('button', { name: '导入视频', exact: true }).click(); await ready();
  await page.getByText(/本次视频可正常使用，但无法记住文件/).waitFor();
  await page.evaluate(() => sessionStorage.removeItem('storageError'));
  checks.push('unsupported/blocked picker uses native file chooser; unavailable IndexedDB does not block validated manual import');

  await page.goto(`${baseURL}/workspace/local`);
  await page.getByLabel('导入本地视频').setInputFiles(file);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
  await page.reload();
  await page.waitForFunction(() => Boolean(document.querySelector('video')));
  assert.equal(await page.locator('video').getAttribute('src'), null);
  checks.push('local workspace retains manual import without cross-refresh video persistence');
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log(JSON.stringify({ browser: browser.version(), checks, errors, unexpected, artifacts }, null, 2));
} catch (error) {
  await page.screenshot({ path: join(artifacts, 'failure.png') }).catch(() => {});
  console.error({ artifacts, errors, unexpected }); throw error;
} finally { await context.close(); await browser.close(); }
