import { test, expect, fixtures, button, login, request, readProject, text, verifyVideo,
  organizationPath, listPath, settingsPath } from './helpers.mjs';

const organizationSettings = `${organizationPath.slice(4)}/settings/organization`;
const permissionPath = `${organizationPath}/member-permissions`;
const panel = page => page.getByRole('form', { name: '成员权限', exact: true });
async function configure(context, changes) {
  const response = await request(context, permissionPath);
  expect(response.status()).toBe(200);
  const config = await response.json();
  const saved = await request(context, permissionPath, 'PUT', { ...config, permissions: { ...config.permissions, ...changes } });
  expect(saved.status()).toBe(200);
  return saved.json();
}
async function observe(page) {
  const observed = page.waitForResponse(r => new URL(r.url()).pathname === fixtures.projectPath && r.request().method() === 'GET');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect((await observed).status()).toBe(200);
}

test('member permissions settings CAS and independent grants retain identity boundaries in both languages', async ({ page, browser }, testInfo) => {
  await login(page, organizationSettings, fixtures.organizer);
  await expect(panel(page).getByRole('checkbox')).toHaveCount(14);
  await expect(panel(page).getByLabel('编辑与保存字幕', { exact: true })).toBeChecked();
  await expect(panel(page).getByLabel('编辑组织术语', { exact: true })).toBeChecked();
  await expect(panel(page).getByLabel('创建项目', { exact: true })).not.toBeChecked();
  const second = await page.context().newPage();
  await second.goto(organizationSettings);
  await expect(panel(second).getByRole('checkbox')).toHaveCount(14);
  await panel(page).getByLabel('创建项目', { exact: true }).check();
  await button(panel(page), '保存权限').click();
  await expect(panel(page).getByRole('status')).toContainText('成员权限已保存');
  await panel(second).getByLabel('修改组织名称', { exact: true }).check();
  await button(panel(second), '保存权限').click();
  await expect(second.getByRole('alert')).toContainText('权限配置已变化');
  await expect(panel(second).getByLabel('修改组织名称', { exact: true })).toBeChecked();
  await button(panel(second), '重新加载权限配置').click();
  await expect(panel(second).getByLabel('创建项目', { exact: true })).toBeChecked();
  await expect(panel(second).getByLabel('修改组织名称', { exact: true })).not.toBeChecked();
  // The same server contract drives independently granted business controls.
  await configure(page.context(), { rename_organization: true, create_style_template: true, edit_style_template: false, delete_style_template: false });
  const memberContext = await browser.newContext({ locale: 'zh-CN', baseURL: 'http://127.0.0.1:5199' });
  const member = await memberContext.newPage();
  await login(member, organizationSettings);
  await expect(panel(member)).toHaveCount(0);
  await expect(member.getByLabel('组织名称', { exact: true })).toBeVisible();
  await expect(member.getByLabel('添加成员', { exact: true })).toHaveCount(0);
  await expect(button(member, '移除')).toHaveCount(0);
  await expect(button(member, '新建模板')).toBeVisible();
  await member.goto(listPath);
  await expect(button(member, '新建项目')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('permissions-zh.png'), fullPage: true });
  // English settings uses the same 14 values and never remounts the project.
  const localeResponse = await request(page.context(), '/api/me/settings', 'PATCH', { language_preference: 'en' });
  expect(localeResponse.status()).toBe(200);
  await page.reload();
  const english = page.getByRole('form', { name: 'Member permissions', exact: true });
  await expect(english.getByRole('checkbox')).toHaveCount(14);
  await expect(english.getByLabel('Create projects', { exact: true })).toBeChecked();
  await expect(english.getByLabel('Edit organization glossary entries', { exact: true })).toBeChecked();
  await expect(button(english, 'Save permissions')).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('permissions-en.png'), fullPage: true });
  await memberContext.close();
});

test('member subtitle revocation and ordered recovery preserve draft media selection and history with independent glossary writes', async ({ page, browser }) => {
  await login(page, fixtures.workspacePath);
  await verifyVideo(page);
  const original = await readProject(page);
  const editor = await text(page).elementHandle();
  const video = await page.locator('video').elementHandle();
  const value = '撤权期间保留的本地字幕';
  await text(page).fill(value);
  await page.getByRole('textbox', { name: '入点', exact: true }).fill('0:00:');
  const adminContext = await browser.newContext({ locale: 'zh-CN', baseURL: 'http://127.0.0.1:5199' });
  const admin = await adminContext.newPage();
  await login(admin, organizationSettings, fixtures.organizer);
  // Hold a genuinely old successful status response while a newer revocation arrives.
  let releaseOld, captured;
  const oldCaptured = new Promise(resolve => { captured = resolve; });
  const hold = new Promise(resolve => { releaseOld = resolve; });
  let intercept = true;
  await page.route(`**${fixtures.projectPath}`, async route => {
    if (route.request().method() !== 'GET' || !intercept) return route.continue();
    intercept = false;
    const response = await route.fetch();
    captured(); await hold;
    await route.fulfill({ response });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await oldCaptured;
  await configure(adminContext, { edit_subtitles: false, fork_project_glossary: true, edit_project_glossary: true });
  await observe(page);
  await expect(text(page)).toBeDisabled();
  const oldReturned = page.waitForResponse(async response => new URL(response.url()).pathname === fixtures.projectPath
    && response.request().method() === 'GET' && (await response.json()).project.effective_permissions.edit_subtitles);
  releaseOld(); await oldReturned;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(text(page)).toBeDisabled();
  await expect(page.getByText('当前成员无字幕编辑权限。本地稿件已保留，仍可浏览与导出。', { exact: true })).toBeVisible();
  await expect(text(page)).toHaveValue(value);
  await expect(page.getByRole('textbox', { name: '入点', exact: true })).toHaveValue('0:00:');
  expect(await editor.evaluate(element => element.isConnected)).toBe(true);
  expect(await video.evaluate(element => element.isConnected)).toBe(true);
  await expect(button(page, '保存项目')).toHaveCount(0);
  // Glossary fork and entry writes do not depend on subtitle edit permission.
  await button(page, '术语表').click();
  await button(page, '创建项目副本').click();
  await expect(page.getByText('当前词条属于项目术语表，修改不会回写组织表，也不会自动接收组织表的新词条。', { exact: true })).toBeVisible();
  await button(page, '添加术语').click();
  await page.getByLabel('原词', { exact: true }).fill('独立术语');
  await page.getByLabel('统一译名', { exact: true }).fill('Independent term');
  await button(page, '保存术语').click();
  await expect(page.getByText('Independent term', { exact: true })).toBeVisible();
  const current = await readProject(admin);
  expect(current.document).toEqual(original.document);
  expect(current.revision).toBe(original.revision);
  const downloaded = page.waitForEvent('download');
  await button(page, '导出 ASS').click();
  expect(await (await downloaded).failure()).toBeNull();
  await configure(adminContext, { edit_subtitles: true });
  await observe(page);
  await expect(text(page)).toBeEditable();
  await expect(text(page)).toHaveValue(value);
  expect(await editor.evaluate(element => element.isConnected)).toBe(true);
  await page.getByRole('main').focus();
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('textbox', { name: '入点', exact: true })).toHaveValue('0:00:00.00');
  await page.keyboard.press('Control+z');
  await expect(text(page)).toHaveValue('甲乙');
  await page.keyboard.press('Control+Shift+z');
  await expect(text(page)).toHaveValue(value);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByRole('textbox', { name: '入点', exact: true })).toHaveValue('0:00:');
  await adminContext.close();
});

test('member project settings and style templates honor independent business capabilities', async ({ page, browser }) => {
  const adminContext = await browser.newContext({ locale: 'zh-CN', baseURL: 'http://127.0.0.1:5199' });
  const admin = await adminContext.newPage();
  await login(admin, organizationSettings, fixtures.organizer);
  await configure(adminContext, { edit_project: true, edit_subtitles: false, manage_project_styles: false,
    create_style_template: true, edit_style_template: false, delete_style_template: true,
    fork_project_glossary: false, edit_project_glossary: false });
  await login(page, settingsPath);
  await expect(page.getByLabel('项目名称', { exact: true })).toBeEditable();
  await expect(button(page, '创建项目副本')).toHaveCount(0);
  await button(page, '管理项目样式').click();
  const styles = page.getByRole('dialog');
  await expect(styles.getByLabel('样式名称', { exact: true })).toBeDisabled();
  // Template creation is independent from editing the project definition.
  await expect(button(styles, '另存为组织模板')).toBeEnabled();
  await button(styles, '另存为组织模板').click();
  await expect(styles.getByText('组织模板已保存，项目样式保持独立。', { exact: true })).toBeVisible();
  await button(styles, '为字幕指定样式').click();
  await expect(button(styles, '选择全部字幕')).toBeDisabled();
  await button(styles, '关闭').click();
  await page.goto(organizationSettings);
  await expect(button(page, '新建模板')).toBeVisible();
  await expect(button(page, '查看')).toBeVisible();
  await expect(button(page, '编辑')).toHaveCount(0);
  await expect(button(page, '删除')).toBeVisible();
  await button(page, '查看').click();
  await expect(page.getByRole('dialog').getByLabel('模板名称', { exact: true })).toBeDisabled();
  await expect(button(page.getByRole('dialog'), '保存模板')).toHaveCount(0);
  await button(page.getByRole('dialog'), '关闭').click();
  await configure(adminContext, { edit_subtitles: true, create_style_template: false, edit_style_template: true, delete_style_template: false });
  await page.reload();
  await expect(button(page, '新建模板')).toHaveCount(0);
  await expect(button(page, '编辑')).toBeVisible();
  await expect(button(page, '删除')).toHaveCount(0);
  await page.goto(settingsPath);
  await button(page, '管理项目样式').click();
  await expect(styles.getByLabel('样式名称', { exact: true })).toBeDisabled();
  await expect(button(styles, '另存为组织模板')).toHaveCount(0);
  await button(styles, '为字幕指定样式').click();
  await expect(button(styles, '选择全部字幕')).toBeEnabled();
  await adminContext.close();
});
