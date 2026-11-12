import { readFile } from 'node:fs/promises';
import { test as base, expect } from 'playwright/test';

const fixtures = JSON.parse(process.env.CUERELAY_REGRESSION_FIXTURES);
const test = base.extend({
  // Each scenario gets a fresh browser context; catch unhandled application errors.
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
const rows = page => page.getByRole('row').filter({ has: page.getByRole('button', { name: /^选择第 \d+ 行$/ }) });

async function openWorkspace(page) {
  await page.goto(fixtures.workspacePath);
  await page.getByLabel('用户名', { exact: true }).fill(fixtures.username);
  await page.getByLabel('密码', { exact: true }).fill(fixtures.password);
  await button(page, '登录').click();
  await verifyVideo(page);
}

async function verifyVideo(page) {
  await page.getByLabel('导入本地视频', { exact: true }).setInputFiles(fixtures.video);
  await button(page, '选择第 1 行').click();
  await expect(text(page)).toBeEnabled(); // Waits for the real complete SHA-256 check.
}

async function history(page, redo = false) {
  await page.getByRole('main').focus();
  await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
}

async function savedProject(page) {
  const response = await page.request.get(fixtures.projectPath);
  expect(response.status()).toBe(200);
  return (await response.json()).project;
}

async function save(page, revision, status = 200) {
  const responsePromise = page.waitForResponse(response =>
    new URL(response.url()).pathname === `${fixtures.projectPath}/document`
      && response.request().method() === 'PUT');
  await button(page, '保存项目').click();
  const response = await responsePromise;
  expect(response.request().postDataJSON().revision).toBe(revision);
  expect(response.status()).toBe(status);
  if (status === 200) await expect(button(page, '保存项目')).toBeDisabled();
  else await expect(page.getByRole('alert')).toContainText('当前输入已保留');
  return response.json();
}

test('save refresh and history', async ({ page }) => {
  await openWorkspace(page);
  await expect(text(page)).toHaveValue('甲乙');

  // Commit on the last row appends one cue. Undo and redo restore the selection.
  await page.getByRole('main').focus();
  await page.keyboard.press('KeyG');
  await expect(rows(page)).toHaveCount(2);
  await expect(button(page, '选择第 2 行')).toHaveAttribute('aria-pressed', 'true');
  const appendedId = await rows(page).last().getAttribute('data-cue-id');
  await history(page);
  await expect(rows(page)).toHaveCount(1);
  await expect(text(page)).toHaveValue('甲乙');
  await history(page, true);
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).last()).toHaveAttribute('data-cue-id', appendedId);
  await text(page).fill('新建字幕');
  await save(page, 1);
  const created = await savedProject(page);
  expect(created.revision).toBe(2);
  expect(created.document.cues.map(({ start_ms, end_ms, text }) => [start_ms, end_ms, text]))
    .toEqual([[0, 2000, '甲乙'], [2000, 4000, '新建字幕']]);

  await page.reload();
  await verifyVideo(page);
  await expect(rows(page)).toHaveCount(2);
  expect((await savedProject(page)).document).toEqual(created.document);

  // Text split is a real atomic HTTP write. Its undo changes only local content.
  await text(page).focus();
  await text(page).evaluate(element => element.setSelectionRange(1, 1));
  const splitResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === `${fixtures.projectPath}/split`
      && response.request().method() === 'POST');
  await text(page).press('Control+t');
  expect((await splitResponse).status()).toBe(200);
  await expect(rows(page)).toHaveCount(3);
  const split = await savedProject(page);
  expect(split.revision).toBe(3);
  expect(split.document.cues.map(({ start_ms, end_ms, text }) => [start_ms, end_ms, text]))
    .toEqual([[0, 1000, '甲'], [1000, 2000, '乙'], [2000, 4000, '新建字幕']]);
  await history(page);
  await expect(rows(page)).toHaveCount(2);
  await expect(text(page)).toHaveValue('甲乙');
  expect(await savedProject(page)).toEqual(split);
  await save(page, 3);
  const undone = await savedProject(page);
  expect(undone.revision).toBe(4);
  expect(undone.document).toEqual(created.document);

  await history(page, true);
  await expect(rows(page)).toHaveCount(3);
  expect(await savedProject(page)).toEqual(undone);
  await save(page, 4); // Redo must not restore the stale server revision.
  const redone = await savedProject(page);
  expect(redone.revision).toBe(5);
  expect(redone.document).toEqual(split.document); // Including the original generated UUIDs.
  await page.reload();
  await verifyVideo(page);
  await history(page);
  await expect(rows(page)).toHaveCount(3); // Refresh establishes a fresh history baseline.
  await expect(text(page)).toHaveValue('甲');
});

test('conflict preserves local edits', async ({ page, context }) => {
  await openWorkspace(page);
  // A second page has an independent in-memory workspace and the same real session.
  const other = await context.newPage();
  await other.goto(fixtures.workspacePath);
  await verifyVideo(other);
  await text(other).fill('远端已保存');
  await save(other, 1);
  const remote = await savedProject(other);
  expect(remote.revision).toBe(2);

  await text(page).fill('本地冲突稿');
  await start(page).fill('0:00:'); // Unapplied and incomplete time draft must survive.
  const conflict = await save(page, 1, 409);
  expect(conflict.error.code).toBe('project_conflict');
  await expect(text(page)).toHaveValue('本地冲突稿');
  await expect(start(page)).toHaveValue('0:00:');
  expect(await savedProject(page)).toEqual(remote);

  // The existing leave/reload protection exports applied content without saving.
  await button(page, '重新加载项目').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: /导出/ }).click();
  const download = await downloadPromise;
  expect(await download.failure()).toBeNull();
  const exported = await readFile(await download.path(), 'utf8');
  expect(exported).toContain('Dialogue: 0,0:00:00.00,0:00:02.00,Default,,0000,0000,0000,,本地冲突稿');
  expect(exported).not.toContain('远端已保存');
  expect(await savedProject(page)).toEqual(remote);
  await expect(dialog).toBeVisible();
  await button(dialog, '取消').click();
  await expect(text(page)).toHaveValue('本地冲突稿');
  await expect(start(page)).toHaveValue('0:00:');
  await save(page, 1, 409); // Failed save must not silently accept remote revision.

  await button(page, '重新加载项目').click();
  await button(page.getByRole('dialog'), '明确放弃并继续').click();
  // Reload replaces the entire instance asynchronously. Select media only after
  // the new document is visible, so it cannot be sent to the outgoing player.
  await expect(button(page, '远端已保存')).toBeVisible();
  await verifyVideo(page);
  await expect(text(page)).toHaveValue('远端已保存');
  await expect(start(page)).toHaveValue('0:00:00.00');
  await history(page);
  await expect(text(page)).toHaveValue('远端已保存');
  expect(await savedProject(page)).toEqual(remote);
});
