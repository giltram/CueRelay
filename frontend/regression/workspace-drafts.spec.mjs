import { readFile } from 'node:fs/promises';
import { test, expect } from 'playwright/test';

const fixtures = JSON.parse(process.env.CUERELAY_REGRESSION_FIXTURES);
const button = (page, name) => page.getByRole('button', { name, exact: true });
const text = page => page.getByRole('textbox', { name: '字幕中文文本', exact: true });
const start = page => page.getByRole('textbox', { name: '入点', exact: true });
const restore = page => button(page, '恢复草稿');
const status = page => page.getByText('本地草稿已保存。', { exact: true });
const conflict = page => page.getByText('草稿与服务器版本不一致。', { exact: false });

async function login(page, path = fixtures.workspacePath, username = fixtures.username) {
  await page.goto(path);
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(fixtures.password);
  await button(page, '登录').click();
}

async function verifyVideo(page) {
  await page.getByLabel('导入本地视频', { exact: true }).setInputFiles(fixtures.video);
  await button(page, '选择第 1 行').click();
  await expect(text(page)).toBeEnabled();
}

async function download(page, name) {
  const event = page.waitForEvent('download');
  await button(page, name).click();
  return readFile(await (await event).path(), 'utf8');
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

async function serverProject(page) {
  const response = await page.request.get(fixtures.projectPath);
  expect(response.ok()).toBe(true);
  return (await response.json()).project;
}

async function manualSave(page) {
  const response = page.waitForResponse(response => response.request().method() === 'PUT'
    && new URL(response.url()).pathname === `${fixtures.projectPath}/document`);
  await button(page, '保存项目').click();
  expect((await response).status()).toBe(200);
}

test('workspace draft local import, export, reload and discard', async ({ page, context }) => {
  await login(page, '/workspace/local');
  const importAss = page.getByLabel('导入基础 ASS', { exact: true });
  await expect(importAss).toBeEnabled();
  await importAss.setInputFiles(fixtures.subtitles);
  await expect(button(page, '选择第 2 行')).toBeVisible();
  await button(page, '选择第 1 行').click();
  await context.setOffline(true);
  await text(page).fill('本机未保存字幕');
  await page.getByLabel('字幕样式', { exact: true }).selectOption({ label: 'Emphasis' });
  await start(page).fill('0:00:01.30');
  await page.getByRole('textbox', { name: '出点', exact: true }).fill('0:00:02.40');
  await page.getByRole('main').focus();
  await page.keyboard.press('KeyG'); // Apply timing through the normal editor.
  await expect(status(page)).toBeVisible();
  await context.setOffline(false);

  await page.reload();
  await expect(restore(page)).toBeEnabled();
  await expect(text(page)).toHaveValue(''); // Opening alone never replaces the blank document.
  await button(page, '使用原始版本').click();
  await expect(restore(page)).toHaveCount(0);
  await button(page, '查看本地草稿').click();
  await restore(page).click();
  await expect(text(page)).toHaveValue('本机未保存字幕');
  await expect(start(page)).toHaveValue('0:00:01.30');
  await expect(page.getByLabel('字幕样式', { exact: true }).locator('option:checked')).toHaveText('Emphasis');
  expect(await download(page, '导出 ASS')).toContain('本机未保存字幕');
  const downloadRecords = await records(page);
  expect(downloadRecords).toHaveLength(1); // Download leaves the recovery copy.

  // A clean new tab can explicitly recover a closed tab's draft.
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto('/workspace/local');
  await expect(restore(reopened)).toBeEnabled();
  await restore(reopened).click();
  await expect(text(reopened)).toHaveValue('本机未保存字幕');
  expect(await records(reopened)).toMatchObject([{ id: downloadRecords[0].id }]);
  expect((await records(reopened))[0].tabId).not.toBe(downloadRecords[0].tabId);
  await reopened.reload();
  await button(reopened, '放弃草稿').click();
  await expect(restore(reopened)).toHaveCount(0);
  expect(await records(reopened)).toHaveLength(0);
  await reopened.reload();
  await expect(text(reopened)).toHaveValue('');
});

test('workspace draft project restores without video and tracks save acknowledgement', async ({ page }) => {
  await login(page);
  await verifyVideo(page);
  await text(page).fill('服务器还没有这行');
  await start(page).fill('0:00:');
  await expect(status(page)).toBeVisible();
  await page.reload();
  await expect(restore(page)).toBeEnabled();
  await expect(page.getByRole('row').filter({ hasText: '甲乙' })).toBeVisible();
  await restore(page).click();
  await expect(text(page)).toHaveValue('服务器还没有这行');
  await expect(text(page)).toBeDisabled(); // Recovery needs no media; edits still need verification.
  await expect(start(page)).toHaveValue('0:00:');
  await verifyVideo(page);
  expect((await serverProject(page)).revision).toBe(1);

  let releaseResponse;
  const responseGate = new Promise(resolve => { releaseResponse = resolve; });
  let notifyRequest;
  const requestStarted = new Promise(resolve => { notifyRequest = resolve; });
  const requestPath = `**${fixtures.projectPath}/document`;
  await page.route(requestPath, async route => {
    const response = await route.fetch(); // Real Django write, held before browser acknowledgement.
    notifyRequest();
    await responseGate;
    await route.fulfill({ response });
  }, { times: 1 });
  const saving = manualSave(page);
  await requestStarted;
  try {
    expect((await serverProject(page)).revision).toBe(2);
    expect(await records(page)).toMatchObject([{ baseRevision: 1, document: { cues: [{ text: '服务器还没有这行' }] } }]);
  } finally { releaseResponse(); }
  await saving;
  await expect(button(page, '保存项目')).toBeDisabled();
  await expect.poll(() => records(page)).toMatchObject([{ baseRevision: 2, timing: { startText: '0:00:' } }]);

  await start(page).fill('0:00:00.00');
  await expect.poll(() => records(page)).toHaveLength(0);
  await text(page).fill('确认之后的新编辑');
  await expect(status(page)).toBeVisible();
  await page.reload();
  await restore(page).click();
  await expect(text(page)).toHaveValue('确认之后的新编辑');
  expect((await serverProject(page)).document.cues[0].text).toBe('服务器还没有这行');
  await button(page, '重新加载项目').click();
  await button(page, '明确放弃并继续').click();
  await expect(page.getByRole('row').filter({ hasText: '服务器还没有这行' })).toBeVisible();
  await expect.poll(() => records(page)).toHaveLength(0);
});

test('workspace draft duplicate tabs and late revision conflict keep both drafts', async ({ page, context }) => {
  await login(page);
  await verifyVideo(page);
  await text(page).fill('第一标签页的草稿');
  await expect(status(page)).toBeVisible();
  const originalId = await page.evaluate(() => sessionStorage.getItem('cuerelay.draft-tab'));

  // Same-origin opener creates the copied sessionStorage that Duplicate Tab
  // must handle. Read it before Vite or React can claim a new storage identity.
  await context.addInitScript(() => {
    window.draftTabAtNavigation = sessionStorage.getItem('cuerelay.draft-tab');
  });
  const opened = page.waitForEvent('popup');
  await page.evaluate(() => { window.open(location.href); });
  const duplicate = await opened;
  await verifyVideo(duplicate);
  expect(await duplicate.evaluate(() => window.draftTabAtNavigation)).toBe(originalId);
  await expect.poll(() => duplicate.evaluate(() => sessionStorage.getItem('cuerelay.draft-tab'))).not.toBe(originalId);
  await expect(restore(duplicate)).toHaveCount(0);
  await text(duplicate).fill('副本标签页的草稿');
  await expect(status(duplicate)).toBeVisible();
  expect(new Set((await records(page)).map(record => record.tabId)).size).toBe(2);

  const fresh = await context.newPage();
  await fresh.goto(fixtures.workspacePath);
  await verifyVideo(fresh);
  await expect(text(fresh)).toHaveValue('甲乙');
  await expect(restore(fresh)).toHaveCount(0);
  await fresh.close();

  await page.reload();
  await expect(restore(page)).toHaveCount(1);
  expect(await page.evaluate(() => sessionStorage.getItem('cuerelay.draft-tab'))).toBe(originalId);
  await restore(page).click();
  await expect(text(page)).toHaveValue('第一标签页的草稿');
  await page.reload();
  await expect(restore(page)).toBeEnabled();

  await manualSave(duplicate); // Change server revision while the recovery offer is already open.
  await restore(page).click();
  await expect(conflict(page)).toBeVisible();
  await expect(restore(page)).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: '甲乙' })).toBeVisible();
  expect(await download(page, '导出草稿 ASS')).toContain('第一标签页的草稿');
  expect((await serverProject(duplicate)).document.cues[0].text).toBe('副本标签页的草稿');

  await text(duplicate).fill('副本后来编辑的草稿');
  await expect(status(duplicate)).toBeVisible();
  await page.reload();
  await expect(conflict(page)).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: '副本标签页的草稿' })).toBeVisible();
  await button(page, '使用服务器版本').click();
  await expect(conflict(page)).toHaveCount(0);
  await button(page, '查看本地草稿').click();
  await button(page, '放弃草稿').click();
  await expect.poll(async () => (await records(page)).map(record => record.document.cues[0].text))
    .toEqual(['副本后来编辑的草稿']);
});

async function switchSession(page, username) {
  await page.request.get('/api/auth/session');
  const csrf = (await page.context().cookies()).find(cookie => cookie.name === 'csrftoken').value;
  const response = await page.request.post('/api/auth/login', {
    data: { username, password: fixtures.password },
    headers: { 'X-CSRFToken': csrf, Origin: new URL(page.url()).origin },
  });
  expect(response.ok()).toBe(true);
}

test('workspace draft account isolation on the same tab and browser', async ({ page }) => {
  await login(page);
  await verifyVideo(page);
  await text(page).fill('成员的草稿');
  await expect(status(page)).toBeVisible();
  const tabId = await page.evaluate(() => sessionStorage.getItem('cuerelay.draft-tab'));
  await switchSession(page, fixtures.organizer);
  await page.reload();
  await verifyVideo(page);
  await expect(text(page)).toHaveValue('甲乙');
  await expect(restore(page)).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('cuerelay.draft-tab'))).toBe(tabId);
  await text(page).fill('组织负责人的草稿');
  await expect(status(page)).toBeVisible();

  await switchSession(page, fixtures.username);
  await page.reload();
  await expect(restore(page)).toHaveCount(1);
  await restore(page).click();
  await expect(text(page)).toHaveValue('成员的草稿');
  expect(new Set((await records(page)).map(record => record.scope)).size).toBe(2);
});

test('workspace draft IndexedDB write failure leaves editing and export usable', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...rest) {
      const request = put.call(this, value, ...rest);
      if (window.failDraftWrites && this.transaction.db.name === 'cuerelay-workspace-drafts') this.transaction.abort();
      return request;
    };
  });
  await login(page, '/workspace/local');
  await text(page).fill('上次成功保存的草稿');
  await expect(status(page)).toBeVisible();
  await page.evaluate(() => { window.failDraftWrites = true; });
  await text(page).fill('写入失败后保留');
  await expect(page.getByText('本地草稿未能保存或读取。', { exact: false })).toBeVisible();
  await text(page).fill('还能继续编辑');
  await expect(text(page)).toHaveValue('还能继续编辑');
  expect(await download(page, '导出 ASS')).toContain('还能继续编辑');
  expect(await records(page)).toMatchObject([{ document: { cues: [{ text: '上次成功保存的草稿' }] } }]);
  await page.reload();
  await restore(page).click();
  await expect(text(page)).toHaveValue('上次成功保存的草稿');
});
