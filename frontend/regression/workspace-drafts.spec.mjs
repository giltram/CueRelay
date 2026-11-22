import { readFile } from 'node:fs/promises';
import { test, expect } from 'playwright/test';

const fixtures = JSON.parse(process.env.CUERELAY_REGRESSION_FIXTURES);
const button = (page, name) => page.getByRole('button', { name, exact: true });
const text = page => page.getByRole('textbox', { name: '字幕中文文本', exact: true });
const start = page => page.getByRole('textbox', { name: '入点', exact: true });
const end = page => page.getByRole('textbox', { name: '出点', exact: true });
const restore = page => button(page, '恢复草稿');
const status = page => page.getByText('本地草稿已保存。', { exact: true });
const conflict = page => page.getByText('草稿与服务器版本不一致。', { exact: false });

async function login(page, path = fixtures.workspacePath, username = fixtures.username) {
  await page.goto(path);
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(fixtures.password);
  await button(page, '登录').click();
}

async function verifyVideo(page, selectFirst = true) {
  await page.getByLabel('导入本地视频', { exact: true }).setInputFiles(fixtures.video);
  await expect(start(page)).toBeEnabled();
  if (selectFirst) {
    await button(page, '选择第 1 行').click();
    await expect(text(page)).toBeEnabled();
  }
}

async function download(page, name) {
  const event = page.waitForEvent('download');
  await button(page, name).click();
  return readFile(await (await event).path(), 'utf8');
}

async function openPersonalSettings(page) {
  const settings = page.getByRole('link', { name: '设置', exact: true });
  await settings.evaluate(link => link.removeAttribute('target'));
  await settings.click();
  await expect(page.getByRole('heading', { name: '个人设置', exact: true })).toBeVisible();
}

async function openLeaveConfirmation(page) {
  await openPersonalSettings(page);
  await page.getByRole('link', { name: '组织设置', exact: true }).click();
  await button(page, '退出此组织').click();
}

async function diagnosticUnsaved(page) {
  // Dirty workspaces now confirm before opening settings. Read the public
  // diagnostic projection in place; export UI has its own browser coverage.
  return page.evaluate(async () => (await import('/src/diagnostics/index.ts')).workspaceStatus().unsaved);
}

async function openDraftOffer(context) {
  const tab = await context.newPage();
  await tab.goto(fixtures.workspacePath);
  await expect(restore(tab)).toBeEnabled();
  return tab;
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
  const importAss = page.getByLabel('导入 ASS / SRT 字幕', { exact: true });
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

test('workspace draft keeps unselected project timing across refresh', async ({ page }) => {
  await login(page);
  await verifyVideo(page, false);
  await start(page).fill('0:00:01.23');
  await expect(status(page)).toBeVisible();
  expect(await records(page)).toMatchObject([{ timing: { cueId: null, startText: '0:00:01.23' } }]);

  await page.reload();
  await restore(page).click();
  await verifyVideo(page, false);
  await expect(button(page, '选择第 1 行')).toBeVisible();
  await expect(text(page)).toHaveValue('');
  await expect(start(page)).toHaveValue('0:00:01.23');
  await expect(end(page)).toHaveValue('0:00:02.00');

  await button(page, '字幕质量检查').click();
  const qcPanel = page.getByRole('complementary', { name: '字幕质量检查' });
  const pendingTiming = qcPanel.getByText(/存在未提交的时间输入/);
  await expect.soft(pendingTiming).toBeVisible();
  expect.soft(await diagnosticUnsaved(page)).toBe(true);
  await expect(page.getByRole('main').filter({ has: start(page) })).toBeVisible();

  await start(page).fill('0:00:00.00');
  await expect.poll(() => records(page)).toHaveLength(0);
  await expect(qcPanel).toBeVisible();
  await expect(pendingTiming).toHaveCount(0);
  expect(await diagnosticUnsaved(page)).toBe(false);
});

test('workspace draft keeps the timing baseline through empty project recovery', async ({ page }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...rest) {
      if (window.writeLegacyTiming && this.transaction.db.name === 'cuerelay-workspace-drafts' && value.timing) {
        const { unselectedEndMs, ...timing } = value.timing;
        return put.call(this, { ...value, timing }, ...rest);
      }
      return put.call(this, value, ...rest);
    };
  });
  await login(page);
  await verifyVideo(page);
  await page.locator('main.editor-workbench').focus(); await page.keyboard.press('Control+Delete');
  await expect(end(page)).toHaveValue('0:00:00.00');
  await end(page).fill('0:00:01.00');
  await expect(status(page)).toBeVisible();
  await page.reload();
  await restore(page).click();
  await verifyVideo(page, false);
  await expect(end(page)).toHaveValue('0:00:01.00');
  await end(page).fill('0:00:00.00');
  await expect.poll(() => records(page)).toMatchObject([{ document: { cues: [] }, timing: null }]);
  await page.reload();
  await restore(page).click();
  await expect(end(page)).toHaveValue('0:00:00.00');

  // Reopening the now-empty server snapshot starts with the proposed 2s baseline.
  await verifyVideo(page, false);
  await manualSave(page);
  await expect.poll(() => records(page)).toHaveLength(0);
  await page.reload();
  await verifyVideo(page, false);
  await expect(end(page)).toHaveValue('0:00:02.00');
  await page.evaluate(() => { window.writeLegacyTiming = true; });
  await end(page).fill('0:00:01.00');
  await expect(status(page)).toBeVisible();
  expect((await records(page))[0].timing).not.toHaveProperty('unselectedEndMs');
  await page.reload();
  await restore(page).click();
  await verifyVideo(page, false);
  await end(page).fill('0:00:00.00');
  await expect.poll(() => records(page)).toMatchObject([{ timing: {
    cueId: null, endText: '0:00:00.00', unselectedEndMs: 2000,
  } }]);
  await page.reload();
  await restore(page).click();
  await expect(end(page)).toHaveValue('0:00:00.00');
});

test('saved workspace leaves the organization without losing the project on failure', async ({ page }) => {
  await login(page);
  await verifyVideo(page);
  await text(page).fill('退出时明确放弃的字幕');
  await expect(status(page)).toBeVisible();
  await manualSave(page);
  await expect.poll(() => records(page)).toHaveLength(0);
  const before = await records(page);
  await openLeaveConfirmation(page);

  const leavePath = '**/api/organizations/*/leave';
  await page.route(leavePath, route => route.fulfill({ status: 503 }), { times: 1 });
  await button(page, '明确放弃并继续').click();
  await expect(page.getByRole('dialog').getByRole('status')).toBeVisible();
  expect(await records(page)).toEqual(before);
  expect((await serverProject(page)).document.cues[0].text).toBe('退出时明确放弃的字幕');

  await page.route('**/api/me/settings', route => route.fulfill({ status: 503 }));
  const left = page.waitForResponse(response => response.url().endsWith('/leave') && response.request().method() === 'POST');
  await button(page, '明确放弃并继续').click();
  expect((await left).ok()).toBe(true);
  await expect.poll(() => records(page)).toHaveLength(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(button(page, '刷新会话与设置')).toBeVisible();
  await expect(page.getByRole('link', { name: '回归测试项目', exact: true })).toHaveCount(0);
});

test('workspace draft dev can manage after leaving with settings unavailable', async ({ page }) => {
  await login(page);
  await openLeaveConfirmation(page);
  await page.route('**/api/me/settings', route => route.fulfill({ status: 503 }));
  const organizations = page.waitForResponse(response => new URL(response.url()).pathname === '/api/organizations');
  await button(page, '明确放弃并继续').click();
  expect(await (await organizations).json()).toMatchObject({ organizations: [{
    name: '回归测试组织', role: null, can_manage: true,
  }] });
  await expect(button(page, '刷新会话与设置')).toBeVisible();
  await expect(page.getByRole('option', { name: '回归测试组织 · dev', exact: true })).toHaveCount(1);
  await expect(page.getByRole('link', { name: '回归测试项目', exact: true })).toBeVisible();
  await expect(button(page, '新建项目')).toBeEnabled();
});

test('workspace discard reaches home and reports local deletion failure', async ({ page }) => {
  await page.addInitScript(() => {
    const remove = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (...args) {
      const request = remove.apply(this, args);
      if (window.failDraftDeletes && this.transaction.db.name === 'cuerelay-workspace-drafts') this.transaction.abort();
      return request;
    };
  });
  await login(page);
  await verifyVideo(page);
  await text(page).fill('删除事务失败时仍在磁盘的草稿');
  await expect(status(page)).toBeVisible();
  await page.getByRole('link', { name: 'CueRelay', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '离开工作区', exact: true })).toBeVisible();
  const before = await records(page);
  await page.evaluate(() => { window.failDraftDeletes = true; });
  await button(page, '明确放弃并继续').click();
  await expect(page.getByRole('alert').filter({ hasText: '无法完成草稿操作' })).toBeVisible();
  await expect(page).toHaveURL(new URL('/', page.url()).href);
  await expect(page.getByRole('link', { name: '回归测试项目', exact: true })).toBeVisible();
  await expect(page.locator('video')).toHaveCount(0);
  expect(await records(page)).toEqual(before);
});

test('workspace draft removes stale offers for export discard and restore', async ({ page, context }) => {
  await login(page);
  await verifyVideo(page);
  await text(page).fill('另一个标签页已放弃的字幕');
  await expect(status(page)).toBeVisible();
  await page.close();

  const actor = await openDraftOffer(context);
  const exportTab = await openDraftOffer(context);
  const discardTab = await openDraftOffer(context);
  const restoreTab = await openDraftOffer(context);

  async function expectUnavailable(tab, action) {
    await button(tab, action).click();
    await expect(restore(tab)).toHaveCount(0);
    await expect(button(tab, '导出草稿 ASS')).toHaveCount(0);
    await expect(tab.getByRole('alert').filter({ hasText: '此草稿已不可用。' })).toBeVisible();
  }

  await restore(actor).click();
  await expect(text(actor)).toHaveValue('另一个标签页已放弃的字幕');
  await expectUnavailable(restoreTab, '恢复草稿');
  await expect(restoreTab.getByRole('row').filter({ hasText: '甲乙' })).toBeVisible();
  expect(await records(actor)).toHaveLength(1);

  await actor.reload();
  await button(actor, '放弃草稿').click();
  await expect.poll(() => records(actor)).toHaveLength(0);

  const exports = [];
  exportTab.on('request', request => {
    if (new URL(request.url()).pathname === '/api/ass/export') exports.push(request);
  });
  await expectUnavailable(exportTab, '导出草稿 ASS');
  await expectUnavailable(discardTab, '放弃草稿');
  expect(exports).toHaveLength(0);
});

test('workspace draft concurrent exports keep both offers', async ({ page, context }) => {
  await login(page);
  await verifyVideo(page);
  const content = '两个标签页都能导出的草稿';
  await text(page).fill(content);
  await expect(status(page)).toBeVisible();
  const [candidate] = await records(page);
  await page.close();

  const first = await openDraftOffer(context);
  const second = await openDraftOffer(context);
  const downloads = [];
  first.on('download', event => downloads.push(event));
  second.on('download', event => downloads.push(event));
  // Keep a real write transaction open so candidate reads stay in flight.
  await first.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('cuerelay-workspace-drafts', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const transaction = db.transaction('drafts', 'readwrite');
      const store = transaction.objectStore('drafts');
      transaction.onabort = () => db.close();
      window.releaseDraftReads = () => transaction.abort();
      function keepOpen() {
        const request = store.get('transaction-blocker');
        request.onsuccess = () => { keepOpen(); resolve(); };
      }
      keepOpen();
    };
  }));
  const holders = () => first.evaluate(async id => {
    const { held } = await navigator.locks.query();
    return held.filter(lock => lock.name === 'cuerelay.draft-tab:' + id).length;
  }, candidate.tabId);
  try {
    await button(first, '导出草稿 ASS').click();
    await expect.poll(holders).toBe(1);
    await button(second, '导出草稿 ASS').click();
    await expect.poll(holders).toBe(2);
    await expect(restore(first)).toBeVisible();
    await expect(restore(second)).toBeVisible();
  } finally {
    await first.evaluate(() => window.releaseDraftReads());
  }
  await expect.poll(() => downloads.length).toBe(2);
  for (const event of downloads) expect(await readFile(await event.path(), 'utf8')).toContain(content);
  await expect(restore(first)).toBeEnabled();
  await expect(restore(second)).toBeEnabled();
  expect(await records(first)).toEqual([candidate]);
});

test('project list loads when personal settings fail', async ({ page, context }) => {
  await context.route('**/api/me/settings', route => route.fulfill({
    status: 503, json: { error: { code: 'unavailable', message: '个人设置暂时无法读取' } },
  }));
  await login(page, '/projects');
  await expect(page.getByRole('alert').filter({ hasText: '个人设置暂时无法读取' })).toBeVisible();
  const projectLink = page.getByRole('link', { name: '回归测试项目', exact: true });
  await expect(projectLink).toBeVisible();
  const organizationList = fixtures.workspacePath.split('/projects/')[0] + '/projects';
  await expect(page).toHaveURL(new RegExp(`${organizationList}$`));
  const opened = page.waitForEvent('popup');
  await projectLink.click();
  const workspace = await opened;
  await expect(workspace.getByRole('row').filter({ hasText: '甲乙' })).toBeVisible();
  await verifyVideo(workspace);
  await start(workspace).fill('0:00:00.25');
  await workspace.getByRole('main').focus();
  await workspace.keyboard.press('KeyG');
  await expect(button(workspace, '选择第 2 行')).toBeVisible();
  await expect(status(workspace)).toBeVisible();
  await workspace.reload();
  await restore(workspace).click();
  await expect(workspace.getByRole('row').filter({ hasText: '甲乙' })).toContainText('0:00:00.25');
});

async function signInOrganizer(page, request) {
  const origin = new URL(page.url()).origin;
  const csrf = async () => (await request.storageState()).cookies.find(cookie => cookie.name === 'csrftoken').value;
  await request.get('/api/auth/session');
  const loginResponse = await request.post('/api/auth/login', {
    data: { username: fixtures.organizer, password: fixtures.password },
    headers: { 'X-CSRFToken': await csrf(), Origin: origin },
  });
  expect(loginResponse.ok()).toBe(true);
  return async () => {
    const revoked = await request.delete(fixtures.revokedMembershipPath, {
      data: {}, headers: { 'X-CSRFToken': await csrf(), Origin: origin },
    });
    expect(revoked.ok()).toBe(true);
  };
}

async function leaveAndRevokeNextOrganization(page, request) {
  await login(page);
  await openLeaveConfirmation(page);
  const revoke = await signInOrganizer(page, request);
  await page.route('**/api/organizations/*/leave', async route => {
    const left = await route.fetch();
    expect(left.ok()).toBe(true);
    await revoke();
    await route.fulfill({ response: left });
  }, { times: 1 });
}

test('workspace leave uses the refreshed organization list', async ({ page, request }) => {
  await leaveAndRevokeNextOrganization(page, request);
  const origin = new URL(page.url()).origin;
  const requested = Promise.withResolvers();
  const release = Promise.withResolvers();
  await page.route('**/api/organizations', async route => {
    requested.resolve();
    await release.promise;
    await route.continue();
  }, { times: 1 });
  await button(page, '明确放弃并继续').click();
  try {
    await requested.promise;
    await expect.soft(page).toHaveURL(origin + '/projects', { timeout: 2000 });
  } finally {
    release.resolve();
  }
  await expect(page).toHaveURL(new RegExp(`${fixtures.availableListPath}$`));
  await expect(page.getByRole('option', { name: /^同步后可访问的组织/ })).toBeAttached();
});

test('workspace leave retries organization refresh from the unscoped list', async ({ page, request }) => {
  await leaveAndRevokeNextOrganization(page, request);
  await page.route('**/api/organizations', route => route.fulfill({
    status: 503, json: { error: { code: 'unavailable', message: '组织列表暂时无法刷新' } },
  }), { times: 1 });
  await button(page, '明确放弃并继续').click();
  const retry = button(page, '刷新会话与设置');
  await expect(retry).toBeVisible();
  await expect(page.getByRole('combobox', { name: '当前组织' })).toBeEnabled();
  await expect.soft(page).toHaveURL(new URL('/projects', page.url()).href);
  await retry.click();
  await expect(page).toHaveURL(new RegExp(`${fixtures.availableListPath}$`));
  await expect(page.getByRole('option', { name: /^同步前可访问的组织/ })).toHaveCount(0);
});

test('organization refresh ignores a late list from before revocation', async ({ page, request }) => {
  await login(page, '/');
  const revoked = page.getByRole('option', { name: /^同步前可访问的组织/ });
  await expect(revoked).toBeAttached();
  const revoke = await signInOrganizer(page, request);
  const captured = Promise.withResolvers();
  const release = Promise.withResolvers();
  await page.route('**/api/organizations', async route => {
    const old = await route.fetch();
    captured.resolve(route.request());
    await release.promise;
    await route.fulfill({ response: old });
  }, { times: 1 });
  const refresh = () => page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await refresh();
  const oldRequest = await captured.promise;
  try {
    await revoke();
    await refresh();
    await expect(revoked).toHaveCount(0);
  } finally {
    release.resolve();
  }
  const oldResponse = await oldRequest.response();
  await oldResponse.finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(revoked).toHaveCount(0);
});

test('workspace draft local timing diagnostics clear at baseline', async ({ page }) => {
  await login(page, '/workspace/local');
  await expect(start(page)).toBeEnabled();
  await start(page).fill('0:00:01.23');
  await expect(status(page)).toBeVisible();
  expect(await diagnosticUnsaved(page)).toBe(true);
  await start(page).fill('0:00:00.00');
  await expect.poll(() => records(page)).toHaveLength(0);
  expect.soft(await diagnosticUnsaved(page)).toBe(false);

  await start(page).fill('0:00:00.25');
  await expect(status(page)).toBeVisible();
  await page.reload();
  await restore(page).click();
  await expect(start(page)).toHaveValue('0:00:00.25');
  expect(await diagnosticUnsaved(page)).toBe(true);
  await start(page).fill('0:00:00.00');
  expect.soft(await diagnosticUnsaved(page)).toBe(false);
  await expect.poll(() => records(page)).toHaveLength(0);
});
