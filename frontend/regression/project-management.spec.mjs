import { test, expect, fixtures, button, login, request, readProject, rows, text,
  organizationPath, listPath, settingsPath, verifyVideo } from './helpers.mjs';

async function creation(page, name) {
  await login(page, listPath, fixtures.organizer);
  await button(page, '新建项目').click();
  const dialog = page.getByRole('dialog', { name: '新建项目', exact: true });
  await dialog.getByLabel('项目名称', { exact: true }).fill(name);
  await dialog.getByLabel('项目说明', { exact: true }).fill('创建说明保留');
  await expect(button(dialog, '创建并打开')).toBeDisabled();
  await dialog.getByLabel('基准视频', { exact: true }).setInputFiles(fixtures.video);
  await expect(dialog.getByText(/完整校验通过/)).toBeVisible();
  return dialog;
}

test('project creates without subtitles after validation failure retains inputs', async ({ page }) => {
  const dialog = await creation(page, '无字幕创建');
  await dialog.getByLabel('选择 ASS / SRT 文件', { exact: true }).setInputFiles({ name: 'bad.ass', mimeType: 'text/plain', buffer: Buffer.from('invalid ass') });
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(button(dialog, '创建并打开')).toBeDisabled();
  await button(dialog, '移除字幕文件').click();
  await expect(button(dialog, '创建并打开')).toBeEnabled();
  // Real server validation, rather than a fabricated failed create response.
  await dialog.getByLabel('项目名称', { exact: true }).fill('   ');
  const failed = page.waitForResponse(r => new URL(r.url()).pathname === `${organizationPath}/projects` && r.request().method() === 'POST');
  await button(dialog, '创建并打开').click(); expect((await failed).status()).toBe(400);
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('项目名称', { exact: true })).toHaveValue('   ');
  await expect(dialog.getByLabel('项目说明', { exact: true })).toHaveValue('创建说明保留');
  await expect(dialog.getByText(/synthetic.mp4.*完整校验通过/)).toBeVisible();
  const list = await page.request.get(`${organizationPath}/projects`);
  expect((await list.json()).total).toBe(1);
  await dialog.getByLabel('项目名称', { exact: true }).fill('无字幕创建');
  const created = page.waitForResponse(r => new URL(r.url()).pathname === `${organizationPath}/projects` && r.request().method() === 'POST');
  await button(dialog, '创建并打开').click();
  const response = await created;
  expect(response.status()).toBe(200); expect(response.request().postDataJSON().source).toBeNull();
  const project = (await response.json()).project;
  expect(project).toMatchObject({ name: '无字幕创建', description: '创建说明保留', revision: 1, status: 'active' });
  expect(project.document.cues).toEqual([]);
  expect(project.media).toEqual((await readProject(page)).media);
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/workspace$`));
  await page.reload(); await expect(rows(page)).toHaveCount(0);
  expect(await readProject(page, `${organizationPath}/projects/${project.id}`)).toEqual(project);
});

test('project creates from ASS with original metadata and refreshes snapshot', async ({ page }) => {
  const dialog = await creation(page, 'ASS 创建');
  await dialog.getByLabel('选择 ASS / SRT 文件', { exact: true }).setInputFiles(fixtures.subtitles);
  await expect(dialog.getByText(/basic.ass · 字幕预检通过/)).toBeVisible();
  const created = page.waitForResponse(r => new URL(r.url()).pathname === `${organizationPath}/projects` && r.request().method() === 'POST');
  await button(dialog, '创建并打开').click();
  const response = await created; expect(response.status()).toBe(200);
  const payload = response.request().postDataJSON();
  const project = (await response.json()).project;
  expect(payload.source).toContain('[V4+ Styles]');
  expect(project.document.source).toBe(payload.source);
  expect(project.document.cues.length).toBeGreaterThan(0);
  expect(project.document.cues.every(cue => project.document.styles.some(style => style.id === cue.style_id))).toBe(true);
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/workspace$`));
  await expect(rows(page)).toHaveCount(project.document.cues.length);
  await page.reload();
  await expect(rows(page)).toHaveCount(project.document.cues.length);
  expect(await readProject(page, `${organizationPath}/projects/${project.id}`)).toEqual(project);
});

test('project list combines organization status search and pagination', async ({ page }) => {
  await login(page, listPath);
  const table = page.locator('.project-table tbody tr');
  await expect(table).toHaveCount(25);
  await expect(table.locator('.project-name')).toHaveText(Array.from({ length: 25 }, (_, index) => `组合 ${String(26 - index).padStart(2, '0')}`));
  await expect(page.locator('.project-pagination')).toContainText('共 28 个项目 · 第 1 页');
  await expect(button(page, '新建项目')).toHaveCount(0);
  await expect(button(page, '归档项目')).toHaveCount(0);
  await button(page, '下一页').click();
  await expect(table).toHaveCount(3);
  await expect(page.locator('.project-pagination')).toContainText('第 2 页');
  await page.getByRole('searchbox', { name: '搜索项目', exact: true }).fill('组合');
  await expect(table).toHaveCount(25);
  await expect(page.locator('.project-pagination')).toContainText('共 27 个项目 · 第 1 页');
  await button(page, '下一页').click(); await expect(table).toHaveCount(2);
  await expect(table.locator('.project-name')).toHaveText(['组合 01', '组合 00']);
  await expect(page.locator('.project-pagination')).toContainText('第 2 页');
  await page.getByRole('tab', { name: '过去项目', exact: true }).click();
  await expect(table).toHaveCount(1); await expect(table).toContainText('组合归档');
  await expect(page.locator('.project-pagination')).toContainText('共 1 个项目 · 第 1 页');
  await expect(button(page, '下一页')).toBeDisabled();
  await page.getByLabel('当前组织', { exact: true }).selectOption(String(fixtures.otherOrganizationId));
  // Organization boundary remounts the list: active is its documented default.
  await expect(page.getByRole('tab', { name: '进行中', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(table).toContainText('另一组织进行中');
  await page.getByRole('tab', { name: '过去项目', exact: true }).click();
  await expect(table).toHaveCount(1); await expect(table).toContainText('另一组织归档');
  await page.getByRole('tab', { name: '进行中', exact: true }).click();
  await expect(table).toContainText('另一组织进行中');
  await page.getByRole('searchbox', { name: '搜索项目', exact: true }).fill('不存在的组合');
  await expect(page.getByText('没有找到匹配的项目。', { exact: true })).toBeVisible();
  await button(page, '清除搜索').click();
  await expect(table).toHaveCount(1); await expect(table).toContainText('另一组织进行中');
  await page.reload(); await expect(table).toHaveCount(1); await expect(table).toContainText('另一组织进行中');
});

test('project metadata archive restore permissions and video gate persist', async ({ page, browser }) => {
  await login(page, settingsPath, fixtures.organizer);
  const name = page.getByLabel('项目名称', { exact: true });
  const description = page.getByLabel('项目说明', { exact: true });
  await name.fill('   '); await description.fill('失败后说明保留');
  const failed = page.waitForResponse(r => new URL(r.url()).pathname === fixtures.projectPath && r.request().method() === 'PATCH');
  await button(page, '保存修改').click(); expect((await failed).status()).toBe(400);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(name).toHaveValue('   '); await expect(description).toHaveValue('失败后说明保留');
  expect((await readProject(page)).revision).toBe(1);
  await name.fill('修改后项目'); await description.fill('持久化项目说明');
  const saved = page.waitForResponse(r => new URL(r.url()).pathname === fixtures.projectPath && r.request().method() === 'PATCH');
  await button(page, '保存修改').click(); expect((await saved).status()).toBe(200);
  await page.reload(); await expect(name).toHaveValue('修改后项目'); await expect(description).toHaveValue('持久化项目说明');
  const active = await readProject(page); expect(active.revision).toBe(2);

  const member = await browser.newContext({ baseURL: 'http://127.0.0.1:5199', locale: 'zh-CN' });
  const errors = [];
  member.on('page', tab => tab.on('pageerror', error => errors.push(String(error))));
  try {
    const memberPage = await member.newPage();
    await login(memberPage, settingsPath);
    await expect(memberPage.getByText('只有组织管理员可以修改项目名称和说明。', { exact: true })).toBeVisible();
    await expect(memberPage.getByLabel('项目名称', { exact: true })).toHaveCount(0);
    expect((await request(member, fixtures.projectPath, 'PATCH', { name: '越权', description: '', revision: 2 })).status()).toBe(403);
    expect((await request(member, `${fixtures.projectPath}/archive`, 'POST', { revision: 2 })).status()).toBe(403);
    expect(await readProject(page)).toEqual(active);
    await memberPage.goto(fixtures.workspacePath);
    await button(memberPage, '选择第 1 行').click(); await expect(text(memberPage)).not.toBeEditable();
    // This is a real but wrong video file; the fixture is generated independently.
    await memberPage.getByLabel('导入本地视频', { exact: true }).setInputFiles(fixtures.wrongVideo);
    await expect(memberPage.getByRole('alert')).toContainText(/不匹配|不一致/);
    await expect(text(memberPage)).not.toBeEditable();
    await verifyVideo(memberPage);
    await page.goto(listPath); await button(page, '归档项目').click();
    await button(page.getByRole('dialog', { name: '归档项目', exact: true }), '确认归档').click();
    await page.getByRole('tab', { name: '过去项目', exact: true }).click();
    await expect(page.locator('.project-table')).toContainText('修改后项目');
    expect((await readProject(page)).revision).toBe(3);
    await page.goto(settingsPath); await expect(name).toBeDisabled(); await expect(description).toBeDisabled();
    await button(page, '管理项目样式').click();
    await expect(button(page.getByRole('dialog'), '应用并保存')).toBeDisabled();
    await button(page.getByRole('dialog'), '关闭').click();
    await memberPage.reload(); await button(memberPage, '选择第 1 行').click();
    await expect(text(memberPage)).not.toBeEditable();
    expect((await request(member, `${fixtures.projectPath}/document`, 'PUT', { revision: 3, document: active.document })).status()).toBe(409);
    await page.goto(listPath); await page.getByRole('tab', { name: '过去项目', exact: true }).click();
    await button(page, '恢复项目').click(); await button(page.getByRole('dialog'), '确认恢复').click();
    await page.getByRole('tab', { name: '进行中', exact: true }).click();
    await expect(page.locator('.project-table')).toContainText('修改后项目');
    await page.goto(settingsPath); await expect(name).toBeEditable();
    await memberPage.reload(); await verifyVideo(memberPage); await text(memberPage).fill('恢复后成员保存');
    const writing = memberPage.waitForResponse(r => r.url().endsWith(`${fixtures.projectPath}/document`) && r.request().method() === 'PUT');
    await button(memberPage, '保存项目').click(); expect((await writing).status()).toBe(200);
    await memberPage.reload(); await expect(rows(memberPage)).toContainText('恢复后成员保存');
    const final = await readProject(page);
    expect(final).toMatchObject({ revision: 5, status: 'active', name: '修改后项目', description: '持久化项目说明', archived_at: null, archived_by: null });
    expect(final.document.cues[0].text).toBe('恢复后成员保存');
    expect(errors).toEqual([]);
  } finally { await member.close(); }
});
