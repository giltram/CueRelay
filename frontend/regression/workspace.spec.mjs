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

async function saveWithStyleRetry(page, revision, latestRevision) {
  const isSave = response => new URL(response.url()).pathname === `${fixtures.projectPath}/document`
    && response.request().method() === 'PUT';
  const first = page.waitForResponse(response => isSave(response) && response.request().postDataJSON().revision === revision);
  const second = page.waitForResponse(response => isSave(response) && response.request().postDataJSON().revision === latestRevision);
  await button(page, '保存项目').click();
  expect((await first).status()).toBe(409);
  const saved = await second;
  expect(saved.status()).toBe(200);
  await expect(button(page, '保存项目')).toBeDisabled();
  return saved.request().postDataJSON();
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

test('project styles refresh and retry', async ({ page, context }) => {
  await openWorkspace(page);
  const settings = await context.newPage();
  const settingsPath = fixtures.workspacePath.replace(/workspace$/, 'settings');
  await settings.goto(settingsPath);
  await expect(button(settings, '管理项目样式')).toBeVisible();
  const manager = tab => tab.getByRole('dialog', { name: '项目样式管理', exact: true });
  const font = tab => manager(tab).getByRole('spinbutton', { name: '字号', exact: true });
  const writes = [];
  settings.on('request', request => {
    if (new URL(request.url()).pathname === `${fixtures.projectPath}/styles` && request.method() === 'POST') {
      writes.push(request.postDataJSON());
    }
  });
  async function apply(tab, revision, status) {
    const responsePromise = tab.waitForResponse(response =>
      new URL(response.url()).pathname === `${fixtures.projectPath}/styles`
        && response.request().method() === 'POST' && response.request().postDataJSON().revision === revision);
    await button(manager(tab), '应用并保存').click();
    expect((await responsePromise).status()).toBe(status);
    if (status === 200) await expect(manager(tab).getByText('项目样式已保存。', { exact: true })).toBeVisible();
    else await expect(manager(tab).getByRole('alert')).toContainText('当前输入已保留');
  }

  // Settings was loaded before the workspace save. Opening styles refreshes it.
  await text(page).fill('打开样式前保存');
  await save(page, 1);
  await button(settings, '管理项目样式').click();
  await font(settings).fill('55');

  // Saving cues while the dialog is open races its baseline; retry must use
  // the entire latest cue snapshot, including added cues and their timing.
  await text(page).fill('弹窗打开后保存');
  await page.getByRole('main').focus();
  await page.keyboard.press('KeyG');
  await expect(rows(page)).toHaveCount(2);
  await text(page).fill('新增的字幕');
  await save(page, 2);
  const beforeStyle = await savedProject(page);
  await apply(settings, 3, 200); // First request at revision 2 gets a real 409.
  expect(writes.map(write => write.revision)).toEqual([2, 3]);
  expect(writes[1].document.cues).toEqual(beforeStyle.document.cues);
  const styled = await savedProject(page);
  expect(styled.revision).toBe(4);
  expect(styled.document.styles[0].fields.Fontsize).toBe('55');
  expect(styled.document.cues).toEqual(beforeStyle.document.cues);
  await expect(button(page, '保存项目')).toBeDisabled();

  // A genuine style conflict must not retry, replace the form, or adopt a new
  // baseline that would let a second click overwrite the other tab's change.
  const other = await context.newPage();
  await other.goto(settingsPath);
  await button(other, '管理项目样式').click();
  await font(settings).fill('56');
  await font(other).fill('57');
  await apply(other, 4, 200);
  await apply(settings, 4, 409);
  await expect(font(settings)).toHaveValue('56');
  expect(writes.map(write => write.revision)).toEqual([2, 3, 4]);
  await apply(settings, 4, 409);
  expect(writes.map(write => write.revision)).toEqual([2, 3, 4, 4]);
  expect((await savedProject(page)).document.styles[0].fields.Fontsize).toBe('57');
  expect((await savedProject(page)).document.cues).toEqual(beforeStyle.document.cues);
  await button(manager(settings), '关闭').click();
  await button(settings, '管理项目样式').click();
  await expect(font(settings)).toHaveValue('57');

  // Only an explicit successful workspace save adopts the remote definitions.
  await text(page).fill('保留在旧工作台的草稿');
  await saveWithStyleRetry(page, 3, 5);
  await expect(text(page)).toHaveValue('保留在旧工作台的草稿');
  expect((await savedProject(page)).document.cues[1].text).toBe('保留在旧工作台的草稿');
  expect((await savedProject(page)).document.styles[0].fields.Fontsize).toBe('57');
});

test('workspace saves after style changes', async ({ page, context }) => {
  await openWorkspace(page);
  await text(page).fill('本地未保存的第一行');
  await page.getByRole('main').focus();
  await page.keyboard.press('KeyG');
  await expect(rows(page)).toHaveCount(2);
  await start(page).fill('0:00:');
  await text(page).fill('重做分支中的第二行');
  await history(page); // Keep a redo branch while saving the rest of the edits.
  await expect(text(page)).toHaveValue('');
  await expect(start(page)).toHaveValue('0:00:');
  const video = await page.locator('video').elementHandle();
  await video.evaluate(element => { element.pause(); element.currentTime = 1.2; });

  const settings = await context.newPage();
  await settings.goto(fixtures.workspacePath.replace(/workspace$/, 'settings'));
  await button(settings, '管理项目样式').click();
  const manager = settings.getByRole('dialog', { name: '项目样式管理', exact: true });
  await manager.getByRole('spinbutton', { name: '字号', exact: true }).fill('55');
  await button(manager, '应用并保存').click();
  await expect(manager.getByText('项目样式已保存。', { exact: true })).toBeVisible();

  const submitted = await saveWithStyleRetry(page, 1, 2);
  expect(submitted.document.styles[0].fields.Fontsize).toBe('55');
  expect(submitted.document.cues.map(cue => cue.text)).toEqual(['本地未保存的第一行', '']);
  expect(submitted.document.cues[1].start_ms).toBe(2000); // Incomplete draft was not committed.
  await expect(start(page)).toHaveValue('0:00:');
  await expect(button(page, '选择第 2 行')).toHaveAttribute('aria-pressed', 'true');
  expect(await video.evaluate(element => element === document.querySelector('video'))).toBe(true);
  expect(await video.evaluate(element => element.currentTime)).toBeCloseTo(1.2, 2);

  // Redo and undo must retain the adopted definitions and latest server revision.
  await history(page, true);
  await expect(text(page)).toHaveValue('重做分支中的第二行');
  await expect(start(page)).toHaveValue('0:00:');
  await save(page, 3);
  expect((await savedProject(page)).document.styles[0].fields.Fontsize).toBe('55');
  await history(page);
  await expect(text(page)).toHaveValue('');
  await save(page, 4);
  await history(page); // Only the raw timing draft changes; document identity is shared.
  await expect(start(page)).toHaveValue('0:00:02.00');
  await expect(button(page, '保存项目')).toBeDisabled();
  await history(page); // Undo the appended cue.
  await expect(rows(page)).toHaveCount(1);
  await save(page, 5);
  await history(page); // Undo the original text edit, using the oldest history snapshot.
  await expect(text(page)).toHaveValue('甲乙');
  await save(page, 6);
  expect((await savedProject(page)).document.styles[0].fields.Fontsize).toBe('55');
});

test('workspace protects history styles deleted remotely', async ({ page, context }) => {
  await openWorkspace(page);
  const settings = await context.newPage();
  await settings.goto(fixtures.workspacePath.replace(/workspace$/, 'settings'));
  await button(settings, '管理项目样式').click();
  const manager = settings.getByRole('dialog', { name: '项目样式管理', exact: true });
  await button(manager, '新建').click();
  await manager.getByRole('textbox', { name: '样式名称', exact: true }).fill('临时样式');
  await button(manager, '应用并保存').click();
  await expect(manager.getByText('项目样式已保存。', { exact: true })).toBeVisible();
  const withTemporary = await savedProject(page);
  const defaultId = withTemporary.document.styles[0].id;
  const temporaryId = withTemporary.document.styles.find(style => style.name === '临时样式').id;
  await page.reload(); await verifyVideo(page); // Establish a baseline containing both styles.
  await page.getByLabel('字幕样式', { exact: true }).selectOption(temporaryId);
  await page.getByLabel('字幕样式', { exact: true }).selectOption(defaultId);
  await text(page).fill('尚未保存的本地稿');

  await manager.getByRole('checkbox', { name: '选择样式 临时样式', exact: true }).check();
  await button(manager, '删除所选').click();
  await button(manager, '确认删除样式').click();
  await expect(manager.getByText('项目样式已保存。', { exact: true })).toBeVisible();
  const remote = await savedProject(page);
  const writes = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === `${fixtures.projectPath}/document` && request.method() === 'PUT') writes.push(request.postDataJSON());
  });
  await save(page, 2, 409);
  await expect(page.getByRole('alert')).toContainText('撤销历史使用的样式已被删除');
  expect(writes).toHaveLength(1);
  expect(await savedProject(page)).toEqual(remote);
  await expect(text(page)).toHaveValue('尚未保存的本地稿');
  await history(page);
  await expect(text(page)).toHaveValue('甲乙');
  await history(page);
  await expect(page.getByLabel('字幕样式', { exact: true })).toHaveValue(temporaryId);
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

test('organization glossary fork stays isolated', async ({ page, context }) => {
  await openWorkspace(page);
  const original = await savedProject(page);
  const organizationApi = fixtures.projectPath.split('/projects/')[0];
  const projectGlossary = `${fixtures.projectPath}/glossary`;
  const subtitleWrites = [];
  page.on('request', request => {
    if (request.method() === 'PUT' && new URL(request.url()).pathname === `${fixtures.projectPath}/document`) subtitleWrites.push(request.url());
  });
  await button(page, '术语表').click();
  const panel = page.getByRole('complementary', { name: '术语表', exact: true });
  await expect(panel).toContainText('组织术语表还没有词条');
  await expect(button(panel, '添加术语')).toHaveCount(0);

  const settings = await context.newPage();
  await settings.goto(`${organizationApi.slice(4)}/settings/organization`);
  const section = settings.getByRole('region', { name: '组织术语表', exact: true });
  const organizationForm = section.getByRole('form', { name: '术语词条' });
  await button(section, '添加术语').click();
  await organizationForm.getByLabel('原词', { exact: true }).fill('Alice');
  await organizationForm.getByLabel('统一译名', { exact: true }).fill('爱丽丝');
  await organizationForm.getByLabel('备注', { exact: true }).fill('组织原备注');
  await button(organizationForm, '保存术语').click();
  await expect(section.getByRole('cell', { name: '爱丽丝', exact: true })).toBeVisible();
  const source = await (await page.request.get(`${organizationApi}/glossary`)).json();

  await page.bringToFront();
  await button(panel, '刷新术语表').click();
  await expect(panel.getByText('爱丽丝', { exact: true })).toBeVisible();
  await expect(button(panel, '编辑')).toBeDisabled();
  const forkedResponse = page.waitForResponse(response => new URL(response.url()).pathname === projectGlossary && response.request().method() === 'PUT');
  await button(panel, '创建项目副本').click();
  expect((await forkedResponse).status()).toBe(200);
  await expect(button(panel, '编辑')).toBeEnabled();
  const copy = await (await page.request.get(projectGlossary)).json();
  expect(copy.uses_organization_default).toBe(false);
  expect(copy.table.id).not.toBe(source.table.id);
  expect(copy.entries[0].id).not.toBe(source.entries[0].id);
  expect(copy.entries[0].note).toBe('组织原备注');
  expect(await savedProject(page)).toEqual(original);

  const projectForm = panel.getByRole('form', { name: '术语词条' });
  await button(panel, '编辑').click();
  await projectForm.getByLabel('统一译名', { exact: true }).fill('项目译名');
  await button(projectForm, '保存术语').click();
  await expect(panel.getByText('项目译名', { exact: true })).toBeVisible();
  await button(panel, '添加术语').click();
  await projectForm.getByLabel('原词', { exact: true }).fill('Project only');
  await projectForm.getByLabel('统一译名', { exact: true }).fill('项目新增');
  await button(projectForm, '保存术语').click();
  await expect(panel.getByText('项目新增', { exact: true })).toBeVisible();
  expect((await (await page.request.get(`${organizationApi}/glossary`)).json()).entries).toEqual(source.entries);

  await settings.bringToFront();
  await button(section, '编辑').click();
  await organizationForm.getByLabel('统一译名', { exact: true }).fill('组织改名');
  await button(organizationForm, '保存术语').click();
  await expect(section.getByRole('cell', { name: '组织改名', exact: true })).toBeVisible();
  await button(section, '添加术语').click();
  await organizationForm.getByLabel('原词', { exact: true }).fill('Organization only');
  await organizationForm.getByLabel('统一译名', { exact: true }).fill('组织新增');
  await button(organizationForm, '保存术语').click();
  await expect(section.getByRole('cell', { name: '组织新增', exact: true })).toBeVisible();
  const privatePage = await (await page.request.get(projectGlossary)).json();
  expect(privatePage.entries.map(entry => entry.translation).sort()).toEqual(['项目新增', '项目译名']);
  expect(privatePage.table.id).toBe(copy.table.id);
  expect(await savedProject(page)).toEqual(original);
  expect(subtitleWrites).toEqual([]);

  await page.reload(); await verifyVideo(page); await button(page, '术语表').click();
  await expect(panel.getByText('项目译名', { exact: true })).toBeVisible();
  await expect(panel.getByText('组织新增', { exact: true })).toHaveCount(0);
});

test('english language preserves editor state', async ({ page }) => {
  await openWorkspace(page);
  const video = page.locator('.video-stage video');
  await page.evaluate(() => { window.__languageVideo = document.querySelector('.video-stage video'); window.__languageSrc = window.__languageVideo.src; });
  await text(page).fill('Unsubmitted English draft 用户内容');
  await start(page).fill('0:unfinished');
  const change = page.waitForResponse(response => response.url().endsWith('/api/me/settings') && response.request().method() === 'PATCH');
  await page.locator('.language-control select').selectOption('en');
  expect((await change).status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('CueRelay — Subtitle editor');
  await expect(page.getByRole('textbox', { name: 'Subtitle text input', exact: true })).toHaveValue('Unsubmitted English draft 用户内容');
  await expect(page.getByRole('textbox', { name: 'Start', exact: true })).toHaveValue('0:unfinished');
  expect(await page.evaluate(() => window.__languageVideo === document.querySelector('.video-stage video') && window.__languageSrc === window.__languageVideo.src)).toBe(true);
  // Save applied subtitles through real Session/CSRF/CAS. The raw time draft remains on the page.
  await button(page, 'Save project').click();
  await expect(button(page, 'Save project')).toBeDisabled();
  expect((await savedProject(page)).document.cues[0].text).toBe('Unsubmitted English draft 用户内容');
  await expect(page.getByRole('textbox', { name: 'Start', exact: true })).toHaveValue('0:unfinished');
  const settings = await page.request.get('/api/me/settings');
  expect((await settings.json()).language_preference).toBe('en');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'Save project', exact: true })).toBeDisabled();
  await page.getByLabel('Import local video', { exact: true }).setInputFiles(fixtures.video);
  await page.getByRole('button', { name: 'Select line 1', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Subtitle text input', exact: true })).toHaveValue('Unsubmitted English draft 用户内容');
});
