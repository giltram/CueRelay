// Real Chrome + codec + JASSUB; isolated HTTP identity/CAS fixtures, no dev DB writes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { codec, uiDocument } from './ass-codec.mjs';

const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-style-management-'));
console.log(`artifacts: ${artifacts}`);
const file = join(artifacts, 'video.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=10:d=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file]);
const bytes = readFileSync(file);
const document = uiDocument();
document.cues = [0, 1].map((i) => ({ id: `new-cue-${i}`, start_ms: i * 2000, end_ms: (i + 1) * 2000, text: `人物 ${i}`, style_id: document.styles[0].id }));
const user = { id: 1, username: 'style-organizer', is_dev: false };
const org = { id: 1, name: '样式夹具组织', role: 'organizer', can_manage: true };
const timestamp = '2026-10-24T00:00:00Z';
let project = { id: 1, organization_id: 1, name: '样式项目', description: '', status: 'active', revision: 1,
  created_at: timestamp, updated_at: timestamp, updated_by: user, archived_at: null, archived_by: null,
  media: { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, duration_ms: 8000 }, document };
let templates = [{ id: randomUUID(), name: 'Actor', fields: { ...document.styles[0].fields, Fontsize: '36', PrimaryColour: '&H0000FFFF' },
  reference: document.script, revision: 1, source_label: 'fixture.ass', created_at: timestamp, updated_at: timestamp, updated_by: user }];
const writes = [], errors = [], external = [], unexpected = [];
let failNext = false;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
context.setDefaultTimeout(15000);
context.on('page', page => {
  page.on('pageerror', error => errors.push(String(error)));
  page.on('dialog', dialog => dialog.accept());
});
context.on('request', request => {
  const url = new URL(request.url());
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) && !['blob:', 'data:'].includes(url.protocol)) external.push(url.href);
});
await context.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
  const data = method === 'GET' ? null : request.postDataJSON();
  const reply = json => route.fulfill({ json });
  const failure = (status, code, message) => route.fulfill({ status, json: { error: { code, message } } });
  const pure = action => {
    const result = codec(action, data ?? {});
    return action === 'export' && result.status === 200 ? route.fulfill({ contentType: 'text/plain', body: result.body.text }) : route.fulfill({ status: result.status, json: result.body });
  };
  if (path === '/api/ass/empty') return reply({ document: uiDocument() });
  if (path === '/api/ass/export') return pure('export');
  if (path === '/api/ass/styles') return pure('styles');
  if (path === '/api/ass/import') return pure('parse');
  if (path === '/api/auth/session') return reply({ user });
  if (path === '/api/organizations') return reply({ organizations: [org] });
  if (path === '/api/me/settings') return reply({ shortcut_overrides: {}, audio_display_mode: 'waveform', mouse_sets_cue_boundary: true });
  if (path === '/api/organizations/1/members') return reply({ members: [{ id: 1, user_id: 1, username: user.username, role: 'organizer', is_active: true }] });
  if (path === '/api/organizations/1/style-templates') {
    if (method === 'GET') return reply({ templates });
    writes.push({ path, data });
    if (templates.some(t => t.name === data.name)) return failure(400, 'invalid_request', '组织内模板名称须唯一。');
    const template = { ...structuredClone(data), id: randomUUID(), revision: 1, created_at: timestamp, updated_at: timestamp, updated_by: user };
    templates.push(template); return reply({ template });
  }
  if (path.startsWith('/api/organizations/1/style-templates/')) {
    const template = templates.find(t => t.id === path.split('/').at(-1));
    if (!template) return failure(404, 'not_found', '模板不存在');
    if (template.revision !== data.revision) return failure(409, 'template_conflict', '模板已更新，请重新加载；输入已保留。');
    writes.push({ path, data });
    if (method === 'DELETE') { templates = templates.filter(t => t.id !== template.id); return reply({ deleted: template.id }); }
    Object.assign(template, data, { revision: template.revision + 1 });
    return reply({ template });
  }
  if (path === '/api/organizations/1/projects/1') return reply({ project });
  if (path === '/api/organizations/1/projects' && method === 'GET') return reply({ projects: [project], total: 1, page: 1, has_more: false });
  if (path === '/api/organizations/1/projects' && method === 'POST') {
    writes.push({ path, data });
    let doc = data.source ? codec('parse', { source: data.source }).body.document : uiDocument();
    if (data.script) doc.script = data.script;
    for (const operation of data.style_imports ?? []) {
      const result = codec('import', { document: doc, template: templates.find(t => t.id === operation.template_id), name: operation.name, mode: operation.mode });
      if (result.status !== 200) return failure(422, 'invalid_ass', result.body.issues[0].message);
      doc = result.body.document;
    }
    project = { ...project, ...data, id: 2, revision: 1, document: doc };
    return reply({ project });
  }
  if (path === '/api/organizations/1/projects/2') return reply({ project });
  if (path === '/api/organizations/1/projects/1/styles') {
    writes.push({ path, data });
    if (failNext) { failNext = false; return failure(503, 'unavailable', '模拟保存失败；输入已保留。'); }
    if (data.revision !== project.revision) return failure(409, 'project_conflict', '项目已被其他操作更新；当前输入已保留。');
    for (const key of ['source', 'styles', 'script']) if (JSON.stringify(data.document[key]) !== JSON.stringify(project.document[key])) return failure(400, 'invalid_request', '样式基准不匹配');
    const op = data.operation;
    let result;
    if (op.type === 'import') {
      const template = templates.find(t => t.id === op.template_id);
      if (!template || template.revision !== op.revision) return failure(409, 'template_conflict', '模板已更新');
      result = codec('import', { document: data.document, template, name: op.name, mode: op.mode });
    } else result = codec('styles', { document: data.document, operation: op });
    if (result.status !== 200) return failure(result.status, 'invalid_ass', result.body.issues[0].message);
    project = { ...project, document: result.body.document, revision: project.revision + 1 };
    return reply({ ...result.body, project });
  }
  unexpected.push(`${method} ${path}`); return route.abort();
});

const page = await context.newPage();
const base = process.env.STYLE_MANAGEMENT_URL || 'http://127.0.0.1:5173';
async function openManager() { await page.getByRole('button', { name: '管理样式', exact: true }).click(); await page.getByRole('dialog', { name: '项目样式管理' }).waitFor(); }
const manager = page.getByRole('dialog', { name: '项目样式管理' });
const apply = () => manager.getByRole('button', { name: '应用并保存', exact: true }).click();
async function applied() { await manager.getByText('样式及已应用的字幕编辑已保存。', { exact: true }).waitFor(); }
async function readyPreview() { await manager.locator('.style-sample figcaption').filter({ hasText: 'ASS 效果预览' }).waitFor(); }
async function closeManager() { await manager.getByRole('button', { name: '关闭', exact: true }).click(); }
try {
  await page.goto(`${base}/organizations/1/projects/1/workspace`);
  await page.getByLabel('导入本地视频').setInputFiles(file);
  await page.waitForFunction(() => !document.querySelector('.cue-editor fieldset')?.disabled);
  await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  await page.getByLabel('字幕中文文本').fill('随样式操作一起保存的字幕');
  await page.getByRole('textbox', { name: '出点', exact: true }).fill('0:00:03.00');
  await openManager();
  await readyPreview();
  await manager.getByRole('button', { name: '复制当前样式', exact: true }).click();
  await manager.getByRole('textbox', { name: '样式名称', exact: true }).fill('人物乙');
  await manager.getByRole('textbox', { name: '主颜色', exact: true }).fill('&H000000FF');
  const canvas = manager.locator('.ass-preview-canvas');
  const instance = await canvas.elementHandle();
  // Check actual rendered pixels and renderer identity after a live color edit.
  for (let attempt = 0; ; attempt++) {
    const png = await manager.locator('.style-sample-stage').screenshot();
    const red = await page.evaluate(async encoded => {
      const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(image.width, image.height), ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0); image.close();
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let red = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] > 140 && data[i + 1] < 100 && data[i + 2] < 100) red++;
      return red;
    }, png.toString('base64'));
    if (red > 30) { writeFileSync(join(artifacts, 'sample-red.png'), png); break; }
    if (attempt > 12) assert.fail('JASSUB sample did not render red subtitle text');
    await page.waitForTimeout(100);
  }
  assert(await instance.evaluate(el => el === document.querySelector('dialog .ass-preview-canvas')));
  await apply(); await applied();
  assert.equal(project.document.cues[0].text, '随样式操作一起保存的字幕');
  assert.equal(project.document.cues[0].end_ms, 2000);
  assert.equal(project.document.styles[1].fields.PrimaryColour, '&H000000FF');
  await closeManager();
  assert.equal(await page.getByRole('textbox', { name: '出点', exact: true }).inputValue(), '0:00:03.00');
  assert(await page.getByRole('button', { name: '保存项目', exact: true }).isDisabled());
  await openManager();
  await manager.getByRole('checkbox', { name: '选择样式 Default', exact: true }).check();
  await manager.getByRole('checkbox', { name: '选择样式 人物乙', exact: true }).check();
  await manager.getByRole('button', { name: '批量编辑', exact: true }).click();
  await manager.getByRole('checkbox', { name: '批量修改字号', exact: true }).check();
  await manager.getByRole('spinbutton', { name: '字号', exact: true }).fill('55');
  await apply(); await applied();
  assert.deepEqual(project.document.styles.map(s => s.fields.Fontsize), ['55', '55']);
  assert.deepEqual(project.document.styles.map(s => s.fields.PrimaryColour), ['&H00FFFFFF', '&H000000FF']);
  assert.deepEqual(Object.keys(writes.at(-1).data.operation.fields), ['Fontsize']);
  await manager.getByRole('button', { name: /^人物乙/ }).click();
  await manager.getByRole('button', { name: '为字幕指定样式', exact: true }).click();
  await manager.getByRole('button', { name: '选择全部字幕', exact: true }).click();
  await manager.getByRole('button', { name: '应用并保存（2 行）', exact: true }).click(); await applied();
  assert(project.document.cues.every(c => c.style_id === project.document.styles[1].id));
  const stableId = project.document.styles[1].id;
  await manager.getByRole('textbox', { name: '样式名称', exact: true }).fill('人物乙改名');
  await apply(); await applied();
  assert(project.document.cues.every(c => c.style_id === stableId));
  await manager.getByRole('checkbox', { name: '选择样式 人物乙改名', exact: true }).check();
  assert(await manager.getByRole('button', { name: '删除所选', exact: true }).isDisabled());
  await manager.getByRole('checkbox', { name: '选择样式 人物乙改名', exact: true }).uncheck();
  await manager.getByRole('textbox', { name: '样式名称', exact: true }).fill('失败后保留');
  failNext = true; await apply();
  await manager.getByRole('alert').filter({ hasText: '模拟保存失败' }).waitFor();
  assert.equal(await manager.getByRole('textbox', { name: '样式名称', exact: true }).inputValue(), '失败后保留');
  assert.equal(project.document.styles[1].name, '人物乙改名');
  await manager.getByRole('button', { name: '当前样式', exact: true }).click();
  await manager.getByRole('button', { name: '从组织导入', exact: true }).click();
  await manager.getByRole('checkbox', { name: 'Actor', exact: true }).check();
  await manager.getByLabel('导入名称 Actor', { exact: true }).fill('组织副本');
  await apply(); await applied();
  const imported = structuredClone(project.document.styles.at(-1));
  assert.equal(imported.origin.template_id, templates[0].id);
  await manager.getByRole('button', { name: '脚本设置', exact: true }).click();
  await manager.getByRole('spinbutton', { name: 'PlayResX', exact: true }).fill('1280');
  await manager.getByRole('spinbutton', { name: 'PlayResY', exact: true }).fill('720');
  await apply(); await applied();
  await manager.getByRole('button', { name: '从组织导入', exact: true }).click();
  await manager.getByLabel('导入名称 Actor', { exact: true }).fill('等比副本');
  await manager.getByLabel('适配方式 Actor', { exact: true }).selectOption('scale');
  await apply(); await applied();
  assert.equal(project.document.styles.at(-1).fields.Fontsize, '72');
  await manager.getByRole('checkbox', { name: '选择样式 Default', exact: true }).check();
  await manager.getByRole('button', { name: '删除所选', exact: true }).click();
  await manager.getByRole('button', { name: '确认删除样式', exact: true }).click(); await applied();
  assert(!project.document.styles.some(s => s.name === 'Default'));
  await readyPreview();
  await manager.screenshot({ path: join(artifacts, 'manager-desktop.png') });
  await page.setViewportSize({ width: 390, height: 900 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await manager.screenshot({ path: join(artifacts, 'manager-mobile.png') });
  await page.setViewportSize({ width: 1440, height: 1000 });
  // A remote change must not be silently overwritten; preserve the form and local cue draft.
  project = { ...project, revision: project.revision + 1 };
  await manager.getByRole('textbox', { name: '样式名称', exact: true }).fill('冲突后保留');
  await apply();
  await manager.getByRole('alert').filter({ hasText: '项目已被其他操作更新' }).waitFor();
  assert.equal(await manager.getByRole('textbox', { name: '样式名称', exact: true }).inputValue(), '冲突后保留');
  await closeManager();
  // The current working snapshot still exports styles and cue names correctly.
  const downloaded = page.waitForEvent('download'); await page.getByRole('button', { name: '导出 ASS', exact: true }).click();
  const download = await downloaded; await download.saveAs(join(artifacts, 'export.ass'));
  const exported = readFileSync(join(artifacts, 'export.ass'), 'utf8');
  assert(exported.includes('PlayResX: 1280'));
  assert(exported.includes('0:00:02.00,人物乙改名,'));
  // Organization edits are independent; source labels and stale template handling remain visible.
  const settings = await context.newPage();
  await settings.goto(`${base}/organizations/1/settings/organization`);
  const library = settings.getByRole('region', { name: '组织样式库', exact: true });
  await library.getByRole('button', { name: '编辑模板', exact: true }).click();
  const templateModal = settings.getByRole('dialog', { name: '编辑组织模板', exact: true });
  await templateModal.getByRole('spinbutton', { name: '字号', exact: true }).fill('80');
  await templateModal.getByLabel('模板来源说明', { exact: true }).fill('维护中的组织模板');
  await templateModal.getByRole('button', { name: '保存模板', exact: true }).click();
  await templateModal.waitFor({ state: 'hidden' });
  assert.deepEqual(project.document.styles.find(s => s.id === imported.id), imported);
  await library.getByRole('button', { name: '编辑模板', exact: true }).click();
  templates[0].revision++;
  await templateModal.getByRole('spinbutton', { name: '字号', exact: true }).fill('90');
  await templateModal.getByRole('button', { name: '保存模板', exact: true }).click();
  await templateModal.getByRole('alert').filter({ hasText: '模板已更新' }).waitFor();
  assert.equal(await templateModal.getByRole('spinbutton', { name: '字号', exact: true }).inputValue(), '90');
  await templateModal.getByRole('button', { name: '关闭模板', exact: true }).click();
  await library.getByRole('button', { name: '新建模板', exact: true }).click();
  const newTemplate = settings.getByRole('dialog', { name: '新建组织模板', exact: true });
  await newTemplate.getByRole('textbox', { name: '模板名称', exact: true }).fill('New Template');
  await newTemplate.getByRole('button', { name: '保存模板', exact: true }).click(); await newTemplate.waitFor({ state: 'hidden' });
  assert.equal(templates.length, 2);
  await library.getByRole('searchbox', { name: '搜索组织样式', exact: true }).fill('New');
  await library.getByRole('button', { name: '删除模板', exact: true }).click();
  await settings.getByRole('button', { name: '确认删除模板', exact: true }).click();
  assert.equal(templates.length, 1);
  await library.getByRole('searchbox', { name: '搜索组织样式', exact: true }).fill('');
  await settings.screenshot({ path: join(artifacts, 'library.png'), fullPage: true });
  // New project form selects a versioned template and script settings in one creation request.
  const creation = await context.newPage();
  await creation.goto(`${base}/organizations/1/projects`);
  await creation.getByRole('button', { name: '新建项目', exact: true }).click();
  const form = creation.getByRole('dialog', { name: '新建项目', exact: true });
  await form.getByLabel('项目名称', { exact: true }).fill('模板初始化');
  await form.getByLabel('基准视频', { exact: true }).setInputFiles(file);
  await form.getByText(/完整校验通过/).waitFor();
  await form.locator('summary').click();
  await form.getByRole('checkbox', { name: 'Actor', exact: true }).check();
  await form.getByRole('button', { name: '创建并打开', exact: true }).click();
  await creation.waitForURL('**/projects/2/workspace');
  assert.equal(project.document.styles.length, 2);
  assert.equal(project.document.styles[1].origin.template_id, templates[0].id);
  assert.equal(writes.at(-1).data.style_imports.length, 1);
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(unexpected, []);
  const result = { checks: ['copy/color', 'atomic batch fields', 'cue assignment/rename', 'failure/conflict preserves drafts', 'snapshot imports', 'PlayRes scale', 'unused deletion', 'real JASSUB preview', 'desktop/mobile', 'ASS export', 'template CRUD/source/conflict', 'new project template'], writes: writes.length, errors, external, unexpected };
  writeFileSync(join(artifacts, 'result.json'), JSON.stringify(result, null, 2));
  console.log('PASS', JSON.stringify(result));
} catch (error) {
  await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
  console.error(JSON.stringify({ errors, external, unexpected })); throw error;
} finally { await context.close(); await browser.close(); }
