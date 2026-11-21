import { readFile } from 'node:fs/promises';
import { test as base, expect } from 'playwright/test';

const fixtures = JSON.parse(process.env.CUERELAY_REGRESSION_FIXTURES);
const test = base.extend({
  context: async ({ context }, use) => {
    const errors = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await use(context);
    expect(errors).toEqual([]);
  },
});
const button = (page, name) => page.getByRole('button', { name, exact: true });
const text = page => page.getByRole('textbox', { name: '字幕中文文本', exact: true });
const start = page => page.getByRole('textbox', { name: '入点', exact: true });
const rawStart = '0:00:';
const documentPath = `${fixtures.projectPath}/document`;

async function verifyVideo(page) {
  await page.getByLabel('导入本地视频', { exact: true }).setInputFiles(fixtures.video);
  await button(page, '选择第 1 行').click();
  await expect(text(page)).toBeEnabled();
}

async function openWorkspace(page) {
  await page.goto(fixtures.workspacePath);
  await page.getByLabel('用户名', { exact: true }).fill(fixtures.username);
  await page.getByLabel('密码', { exact: true }).fill(fixtures.password);
  await button(page, '登录').click();
  await verifyVideo(page);
}

async function project(request) {
  const response = await request.get(fixtures.projectPath);
  expect(response.status()).toBe(200);
  return (await response.json()).project;
}

function records(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('cuerelay-workspace-drafts', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('drafts');
      const read = transaction.objectStore('drafts').getAll();
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
      transaction.oncomplete = () => db.close();
    };
  }));
}

const editedDocument = (original, value) => ({
  ...original.document, cues: [{ ...original.document.cues[0], text: value }],
});

async function persistedDraft(page, document) {
  await expect.poll(() => records(page)).toMatchObject([{
    baseRevision: 1, document,
    timing: { cueId: document.cues[0].id, startText: rawStart, endText: '0:00:02.00' },
  }]);
  const stored = await records(page);
  expect(stored).toHaveLength(1);
  expect(stored[0].document).toEqual(document);
  return stored[0];
}

function observeWrites(page) {
  const writes = [];
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    if ((path === fixtures.projectPath || path.startsWith(`${fixtures.projectPath}/`))
      && !['GET', 'HEAD'].includes(request.method())) {
      writes.push({ path, method: request.method(), body: request.postDataJSON() });
    }
  });
  return writes;
}

async function organizerRequest(page, request) {
  const origin = new URL(page.url()).origin;
  const csrf = async () => (await request.storageState()).cookies.find(cookie => cookie.name === 'csrftoken').value;
  await request.get('/api/auth/session');
  const response = await request.post('/api/auth/login', {
    data: { username: fixtures.organizer, password: fixtures.password },
    headers: { 'X-CSRFToken': await csrf(), Origin: origin },
  });
  expect(response.status()).toBe(200);
  return { 'X-CSRFToken': await csrf(), Origin: origin };
}

async function backupAndCancel(page, original, value) {
  await button(page, '重新加载项目').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('保存和导出都不会包含它们');
  const downloaded = page.waitForEvent('download');
  await button(dialog, '导出 ASS').click();
  const download = await downloaded;
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toMatch(/^回归测试项目_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.ass$/);
  const source = await readFile(await download.path(), 'utf8');
  // The complete fixture header, both styles and event metadata must survive.
  expect(source).toBe(original.document.source.replace(/^Dialogue:.*$/m,
    `Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0000,0000,0000,,${value}`));
  await expect(dialog).toBeVisible();
  await expect(button(dialog, '保存并离开')).toBeDisabled();
  await button(dialog, '取消').click();
  await expect(text(page)).toHaveValue(value);
  await expect(start(page)).toHaveValue(rawStart);
}

test('workspace revocation preserves local edits and backup', async ({ page, request }) => {
  await openWorkspace(page);
  const original = await project(page.request);
  const writes = observeWrites(page);
  const editor = await text(page).elementHandle();
  const value = '{\\i1}撤权本机稿{\\i0}\\N第二行, 保留';
  await text(page).fill(value);
  await start(page).fill(rawStart);
  const stored = await persistedDraft(page, editedDocument(original, value));

  // An independent real organizer session changes membership in PostgreSQL.
  const headers = await organizerRequest(page, request);
  const revoked = await request.delete(fixtures.membershipPath, { data: {}, headers });
  expect(revoked.status()).toBe(200);
  expect(await revoked.json()).toEqual({ ok: true });
  const observed = page.waitForResponse(response => new URL(response.url()).pathname === fixtures.projectPath
    && response.request().method() === 'GET');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const denied = await observed;
  expect(denied.status()).toBe(403);
  expect((await denied.json()).error.code).toBe('permission_denied');
  await expect(text(page)).toBeDisabled();
  await expect(start(page)).toBeDisabled();
  await expect(text(page)).toBeVisible();
  await expect(button(page, '保存项目')).toHaveCount(0);
  await expect(page.getByText('当前无法验证项目访问权限，仅可查看和导出。请重新登录或检查组织权限。', { exact: true })).toBeVisible();
  expect(await editor.evaluate(element => element === document.querySelector('textarea'))).toBe(true);

  await page.getByRole('main').focus();
  await page.keyboard.press('KeyG');
  await page.keyboard.press('Control+t');
  await backupAndCancel(page, original, value);
  expect(await records(page)).toEqual([stored]);
  expect(writes).toEqual([]);
  expect(await project(request)).toEqual(original);
});

test('workspace lost save response preserves draft and recovers explicitly', async ({ page }) => {
  await openWorkspace(page);
  const original = await project(page.request);
  const writes = observeWrites(page);
  const committed = editedDocument(original, fixtures.committedText);
  await text(page).fill(fixtures.committedText);
  await start(page).fill(rawStart);
  const stored = await persistedDraft(page, committed);

  const intercepted = Promise.withResolvers();
  await page.route(`**${documentPath}`, async route => {
    try {
      expect(route.request().method()).toBe('PUT');
      const response = await route.fetch({ maxRetries: 0 });
      expect(response.status()).toBe(200);
      expect((await response.json()).project.revision).toBe(2);
      const saved = await project(page.request);
      expect(saved.revision).toBe(2);
      expect(saved.document).toEqual(committed);
      await route.abort('failed'); // The browser never receives the successful write response.
      intercepted.resolve(saved);
    } catch (reason) { intercepted.reject(reason); }
  }, { times: 1 });
  await button(page, '保存项目').click();
  const saved = await intercepted.promise;
  await expect(page.getByRole('alert')).toContainText('未收到服务器响应，操作结果未知；请重载确认后再重试。');
  await expect(button(page, '保存项目')).toBeEnabled();
  await expect(page.getByText('项目已保存。尚未应用的时间输入不包含在本次保存中。', { exact: true })).toHaveCount(0);
  await expect(text(page)).toHaveValue(fixtures.committedText);
  await expect(start(page)).toHaveValue(rawStart);
  expect(await records(page)).toEqual([stored]);
  expect(writes).toEqual([{ path: documentPath, method: 'PUT', body: { revision: 1, document: committed } }]);
  expect(await project(page.request)).toEqual(saved);

  const value = '{\\b1}响应丢失后的本机新稿{\\b0}\\N另存, 保留';
  await text(page).fill(value);
  const local = editedDocument(original, value);
  const latestDraft = await persistedDraft(page, local);
  expect(latestDraft.id).toBe(stored.id);
  const conflict = page.waitForResponse(response => new URL(response.url()).pathname === documentPath
    && response.request().method() === 'PUT');
  await button(page, '保存项目').click(); // Explicit user action still carries the unacknowledged revision.
  const rejected = await conflict;
  expect(rejected.status()).toBe(409);
  expect((await rejected.json()).error.code).toBe('project_conflict');
  await expect(page.getByRole('alert')).toContainText('当前输入已保留');
  await expect(button(page, '保存项目')).toBeEnabled();
  await backupAndCancel(page, original, value);
  expect(await records(page)).toEqual([latestDraft]);
  expect(writes).toEqual([
    { path: documentPath, method: 'PUT', body: { revision: 1, document: committed } },
    { path: documentPath, method: 'PUT', body: { revision: 1, document: local } },
  ]);
  expect(await project(page.request)).toEqual(saved);

  await button(page, '重新加载项目').click();
  await button(page.getByRole('dialog'), '明确放弃并继续').click();
  await expect(button(page, fixtures.committedText)).toBeVisible();
  await verifyVideo(page);
  await expect(text(page)).toHaveValue(fixtures.committedText);
  await expect(start(page)).toHaveValue('0:00:00.00');
  await expect.poll(() => records(page)).toEqual([]);
  await text(page).fill(fixtures.recoveredText);
  const acknowledged = page.waitForResponse(response => new URL(response.url()).pathname === documentPath
    && response.request().method() === 'PUT');
  await button(page, '保存项目').click();
  const response = await acknowledged;
  expect(response.status()).toBe(200);
  expect((await response.json()).project.revision).toBe(3);
  await expect(button(page, '保存项目')).toBeDisabled();
  await expect.poll(() => records(page)).toEqual([]);
  expect(writes).toEqual([
    { path: documentPath, method: 'PUT', body: { revision: 1, document: committed } },
    { path: documentPath, method: 'PUT', body: { revision: 1, document: local } },
    { path: documentPath, method: 'PUT', body: { revision: 2, document: editedDocument(original, fixtures.recoveredText) } },
  ]);
  const recovered = await project(page.request);
  expect(recovered.revision).toBe(3);
  expect(recovered.document).toEqual(editedDocument(original, fixtures.recoveredText));
});
