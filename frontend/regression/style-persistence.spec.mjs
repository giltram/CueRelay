import { test, expect, fixtures, button, login, request, readProject, organizationPath, settingsPath } from './helpers.mjs';

test('styles template CRUD member imports batch copy and references persist', async ({ page, browser }) => {
  await login(page, `${organizationPath.slice(4)}/settings/organization`, fixtures.organizer);
  const library = page.getByRole('region', { name: '组织样式库', exact: true });
  const templatePath = `${organizationPath}/style-templates`;
  const templates = async () => {
    const response = await page.request.get(templatePath); expect(response.status()).toBe(200);
    return (await response.json()).templates;
  };
  async function create(name, size) {
    await button(library, '新建模板').click();
    const dialog = page.getByRole('dialog', { name: '新建组织模板', exact: true });
    await dialog.getByLabel('模板名称', { exact: true }).fill(name);
    await dialog.getByRole('spinbutton', { name: '字号', exact: true }).fill(size);
    await dialog.getByLabel('模板来源说明', { exact: true }).fill('真实模板来源');
    const pending = page.waitForResponse(r => new URL(r.url()).pathname === templatePath && r.request().method() === 'POST');
    await button(dialog, '保存模板').click(); expect((await pending).status()).toBe(200);
    await expect(dialog).toHaveCount(0); await expect(library.getByRole('cell', { name: new RegExp(`^${name}`) })).toBeVisible();
  }
  await create('组织甲', '36');
  await button(library, '新建模板').click();
  const duplicate = page.getByRole('dialog', { name: '新建组织模板', exact: true });
  await duplicate.getByLabel('模板名称', { exact: true }).fill('组织甲');
  await duplicate.getByLabel('模板来源说明', { exact: true }).fill('失败后保留来源');
  const rejected = page.waitForResponse(r => new URL(r.url()).pathname === templatePath && r.request().method() === 'POST');
  await button(duplicate, '保存模板').click(); expect((await rejected).status()).toBe(400);
  await expect(duplicate.getByRole('alert')).toBeVisible();
  await expect(duplicate.getByLabel('模板名称', { exact: true })).toHaveValue('组织甲');
  await expect(duplicate.getByLabel('模板来源说明', { exact: true })).toHaveValue('失败后保留来源');
  expect(await templates()).toHaveLength(1);
  await button(duplicate, '取消').click(); await create('组织乙', '40');
  const templateRow = name => library.getByRole('row').filter({ has: page.getByRole('cell', { name: new RegExp(`^${name}`) }) });
  await button(templateRow('组织甲'), '编辑').click();
  const edit = page.getByRole('dialog', { name: '编辑组织模板', exact: true });
  await edit.getByRole('spinbutton', { name: '字号', exact: true }).fill('38');
  const updated = page.waitForResponse(r => r.url().includes('/style-templates/') && r.request().method() === 'PUT');
  await button(edit, '保存模板').click(); expect((await updated).status()).toBe(200); await expect(edit).toHaveCount(0);
  await page.reload();
  const originals = await templates();
  const first = originals.find(template => template.name === '组织甲');
  expect(first.revision).toBe(2); expect(first.fields.Fontsize).toBe('38');

  const member = await browser.newContext({ baseURL: 'http://127.0.0.1:5199', locale: 'zh-CN', viewport: { width: 1440, height: 1000 } });
  const errors = [];
  member.on('page', tab => tab.on('pageerror', error => errors.push(String(error))));
  try {
    const tab = await member.newPage();
    await login(tab, `${organizationPath.slice(4)}/settings/organization`);
    const memberLibrary = tab.getByRole('region', { name: '组织样式库', exact: true });
    await expect(button(memberLibrary, '查看')).toHaveCount(2);
    for (const name of ['新建模板', '编辑', '删除']) await expect(button(memberLibrary, name)).toHaveCount(0);
    const input = { name: '越权模板', fields: first.fields, reference: first.reference, source_label: '' };
    expect((await request(member, templatePath, 'POST', input)).status()).toBe(403);
    expect((await request(member, `${templatePath}/${first.id}`, 'PUT', { ...input, revision: first.revision })).status()).toBe(403);
    expect((await request(member, `${templatePath}/${first.id}`, 'DELETE', { revision: first.revision })).status()).toBe(403);
    expect(await templates()).toEqual(originals);
    await tab.goto(settingsPath); await button(tab, '管理项目样式').click();
    const manager = tab.getByRole('dialog', { name: '项目样式管理', exact: true });
    async function apply(revision, type, status = 200) {
      const pending = tab.waitForResponse(r => r.url().endsWith(`${fixtures.projectPath}/styles`) && r.request().method() === 'POST');
      await button(manager, '应用并保存').click();
      const response = await pending;
      expect(response.status()).toBe(status);
      expect(response.request().postDataJSON()).toMatchObject({ revision, operation: { type } });
      if (status === 200) await expect(manager.getByText('项目样式已保存。', { exact: true })).toBeVisible();
      else await expect(manager.getByRole('alert')).toBeVisible();
      expect((await readProject(tab)).revision).toBe(revision + (status === 200 ? 1 : 0));
      return response.request().postDataJSON();
    }
    const baseline = await readProject(tab);
    await button(manager, '从组织导入').click();
    for (const name of ['组织甲', '组织乙']) {
      await manager.getByRole('checkbox', { name, exact: true }).check();
      await manager.getByLabel(`导入名称 ${name}`, { exact: true }).fill('同名副本');
      await manager.getByLabel(`适配方式 ${name}`, { exact: true }).selectOption('copy');
    }
    await apply(1, 'import_many', 422);
    expect(await readProject(tab)).toEqual(baseline);
    for (const name of ['组织甲', '组织乙']) {
      await expect(manager.getByRole('checkbox', { name, exact: true })).toBeChecked();
      await expect(manager.getByLabel(`导入名称 ${name}`, { exact: true })).toHaveValue('同名副本');
    }
    await manager.getByLabel('导入名称 组织甲', { exact: true }).fill('副本甲');
    await manager.getByLabel('导入名称 组织乙', { exact: true }).fill('副本乙');
    const importedRequest = await apply(1, 'import_many'); expect(importedRequest.operation.imports).toHaveLength(2);
    const imported = await readProject(tab);
    expect(imported.document.cues).toEqual(baseline.document.cues);
    for (const [name, template] of [['副本甲', first], ['副本乙', originals.find(item => item.name === '组织乙')]]) {
      const style = imported.document.styles.find(item => item.name === name);
      expect(style.fields).toEqual(template.fields);
      expect(style.origin).toMatchObject({ template_id: template.id, revision: template.revision });
      expect(style.id).not.toBe(template.id);
    }
    for (const name of ['副本甲', '副本乙']) await manager.getByRole('checkbox', { name: `选择样式 ${name}`, exact: true }).check();
    await button(manager, '批量编辑').click();
    await manager.getByRole('checkbox', { name: '批量修改字号', exact: true }).check();
    await manager.getByRole('spinbutton', { name: '字号', exact: true }).fill('55');
    const batch = await apply(2, 'batch'); expect(batch.operation.fields).toEqual({ Fontsize: '55' });
    const batched = await readProject(tab);
    expect(batched.document.styles).toEqual(imported.document.styles.map(style => ['副本甲', '副本乙'].includes(style.name)
      ? { ...style, fields: { ...style.fields, Fontsize: '55' } } : style));
    await button(manager, '复制当前样式').click();
    await manager.getByLabel('样式名称', { exact: true }).fill('临时复制');
    await apply(3, 'copy');
    await manager.getByRole('button', { name: /^副本甲/ }).click();
    const referenceId = batched.document.styles.find(style => style.name === '副本甲').id;
    await button(manager, '为字幕指定样式').click(); await button(manager, '选择全部字幕').click();
    const assigning = tab.waitForResponse(r => r.url().endsWith(`${fixtures.projectPath}/styles`) && r.request().method() === 'POST');
    await button(manager, '应用并保存（1 行）').click();
    expect((await assigning).status()).toBe(200);
    await expect(manager.getByText('项目样式已保存。', { exact: true })).toBeVisible();
    expect((await readProject(tab)).revision).toBe(5);
    await manager.getByLabel('样式名称', { exact: true }).fill('引用改名'); await apply(5, 'update');
    await manager.getByRole('checkbox', { name: '选择样式 引用改名', exact: true }).check();
    await expect(button(manager, '删除所选')).toBeDisabled();
    await manager.getByRole('checkbox', { name: '选择样式 引用改名', exact: true }).uncheck();
    await manager.getByRole('checkbox', { name: '选择样式 临时复制', exact: true }).check();
    await button(manager, '删除所选').click();
    const deleting = tab.waitForResponse(r => r.url().endsWith(`${fixtures.projectPath}/styles`) && r.request().method() === 'POST');
    await button(manager, '确认删除样式').click(); expect((await deleting).status()).toBe(200);
    await expect(manager.getByText('项目样式已保存。', { exact: true })).toBeVisible();
    const project = await readProject(tab); expect(project.revision).toBe(7);
    expect(project.document.cues[0].style_id).toBe(referenceId);
    expect(project.document.styles.find(style => style.id === referenceId).name).toBe('引用改名');
    expect(project.document.styles.some(style => style.name === '临时复制')).toBe(false);

    // Editing and deleting organization templates cannot mutate copied projects.
    await button(templateRow('组织甲'), '编辑').click();
    await edit.getByRole('spinbutton', { name: '字号', exact: true }).fill('80');
    const templateEdit = page.waitForResponse(r => r.url().includes('/style-templates/') && r.request().method() === 'PUT');
    await button(edit, '保存模板').click(); expect((await templateEdit).status()).toBe(200); await expect(edit).toHaveCount(0);
    expect(await readProject(tab)).toEqual(project);
    for (const name of ['组织甲', '组织乙']) {
      await button(templateRow(name), '删除').click();
      const pending = page.waitForResponse(r => r.url().includes('/style-templates/') && r.request().method() === 'DELETE');
      await button(page.getByRole('dialog', { name: '删除组织模板', exact: true }), '确认删除模板').click();
      expect((await pending).status()).toBe(200);
      await expect(page.getByRole('dialog', { name: '删除组织模板', exact: true })).toHaveCount(0);
    }
    await page.reload(); expect(await templates()).toEqual([]);
    await tab.reload(); await button(tab, '管理项目样式').click();
    await expect(manager.getByRole('checkbox', { name: '选择样式 引用改名', exact: true })).toBeVisible();
    expect(await readProject(tab)).toEqual(project);
    const exported = await tab.request.post('/api/ass/export', { data: { document: project.document } });
    expect(exported.status()).toBe(200); expect(await exported.text()).toContain(',引用改名,');
    expect(project.document.cues.every(cue => project.document.styles.some(style => style.id === cue.style_id))).toBe(true);
    expect(errors).toEqual([]);
  } finally { await member.close(); }
});
