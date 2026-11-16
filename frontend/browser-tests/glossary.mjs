// Real browser/editor/media and pure ASS codec; isolated HTTP fixture, no DB writes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { sameTab } from './link-navigation.mjs';
import { codec, uiDocument } from './ass-codec.mjs';
const output = mkdtempSync(join(tmpdir(), 'cuerelay-glossary-'));
const videoFile = join(output, 'video.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=8',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', videoFile]);
const bytes = readFileSync(videoFile), doc = uiDocument();
doc.cues = [{ id: 'new-one', text: '甲乙丙', start_ms: 0, end_ms: 2000, style_id: doc.styles[0].id },
  { id: 'new-two', text: '第二行', start_ms: 2000, end_ms: 4000, style_id: doc.styles[0].id }];
const project = { id: 7, organization_id: 1, name: 'Video', description: '', status: 'active', revision: 3,
  document: doc, media: { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, duration_ms: 8000 },
  created_at: '2026-11-12T00:00:00Z', updated_at: '2026-11-12T00:00:00Z', updated_by: { username: 'member' }, archived_at: null, archived_by: null };
const tables = new Map(), links = new Map([[7, { version: 1, id: null }], [8, { version: 1, id: null }], [9, { version: 1, id: null }]]);
let organizationTableId = null;
let sessionUser = { id: 1, username: 'member', is_dev: false }, denyRead = false;
let manage = false, failWrite = '', failRead = false, heldRead = null, heldWrite = null, reads = 0;
const requests = [], unexpected = [], errors = [], checks = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
context.on('page', page => {
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('Encountered two children with the same key')) errors.push(message.text()); });
});
const summary = id => {
  const row = tables.get(id);
  return row ? { id, name: row.name, created_at: '2026-11-12T00:00:00Z', is_organization_default: id === organizationTableId, project_count: [...links.values()].filter(link => link.id === id || (link.id === null && id === organizationTableId)).length } : null;
};
const snapshot = (projectId, search = '') => {
  const link = projectId === null ? { version: 1, id: null } : links.get(projectId), id = link.id ?? organizationTableId, table = tables.get(id);
  const entries = (table?.entries ?? []).filter(entry => [entry.original, entry.translation, entry.note].some(value => value.toLowerCase().includes(search.toLowerCase())));
  return { association_version: link.version, table: summary(id), uses_organization_default: link.id === null, archived: projectId === 9,
    entries, empty: !table?.entries.length, total: entries.length, page: 1, has_more: false };
};
function gate() {
  let entered, release;
  return { started: new Promise(resolve => { entered = resolve; }), wait: new Promise(resolve => { release = resolve; }), entered: () => entered(), release: () => release() };
}
await context.route('**/api/**', async route => {
  const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
  requests.push({ path, method, body: req.postDataJSON() });
  const json = value => route.fulfill({ json: value });
  const failure = (code, message, status = 409) => route.fulfill({ status, json: { error: { code, message } } });
  if (path === '/api/auth/session') return json({ user: sessionUser });
  if (path === '/api/organizations') return json({ organizations: [{ id: 1, name: '字幕组', role: manage ? 'organizer' : 'member', can_manage: manage }] });
  if (path === '/api/organizations/1/members') return json({ members: [] });
  if (path === '/api/organizations/1/style-templates') return json({ templates: [] });
  if (path === '/api/me/settings') return json({ handbook_seen: true, shortcut_overrides: {}, mouse_sets_cue_boundary: true, audio_display_mode: 'spectrum' });
  if (path === '/api/ass/inspect') return json(codec('inspect', req.postDataJSON()).body);
  if (path === '/api/ass/export') return route.fulfill({ contentType: 'text/plain', body: codec('export', req.postDataJSON()).body.text });
  if (path === '/api/ass/empty') return json({ document: doc });
  if (path === '/api/organizations/1/projects') return json({ projects: [project, { ...project, id: 8, name: 'Second' }], total: 2, page: 1, has_more: false });
  if (/^\/api\/organizations\/1\/projects\/\d+$/.test(path)) {
    const id = Number(path.split('/').at(-1));
    return json({ project: { ...project, id, name: id === 7 ? 'Video' : 'Second', status: id === 9 ? 'archived' : 'active' } });
  }
  const match = path.match(/^\/api\/organizations\/1\/(?:projects\/(\d+)\/)?glossary(.*)$/);
  if (match) {
    const projectId = match[1] ? Number(match[1]) : null, suffix = match[2], link = projectId === null ? { version: 1, id: null } : links.get(projectId);
    if (method === 'GET' && !suffix) {
      reads++;
      if (denyRead) return failure('permission_denied', '已无权访问术语表。', 403);
      const value = snapshot(projectId, url.searchParams.get('search') ?? '');
      if (heldRead) { const pending = heldRead; heldRead = null; pending.entered(); await pending.wait; }
      if (failRead) { failRead = false; return failure('request_failed', '查询失败', 503); }
      return json(value);
    }
    if (method === 'GET' && suffix.includes('/entries/')) {
      const entry = tables.get(link.id ?? organizationTableId)?.entries.find(row => row.id === suffix.split('/').at(-1));
      return json({ entry });
    }
    const body = req.postDataJSON();
    if (heldWrite) { const pending = heldWrite; heldWrite = null; pending.entered(); await pending.wait; }
    if (failWrite) { const code = failWrite; failWrite = ''; return failure(code, code === 'glossary_conflict' ? '词条已被其他人修改，当前输入已保留。' : '保存失败，输入已保留。', code === 'glossary_conflict' ? 409 : 503); }
    const effectiveId = link.id ?? organizationTableId;
    if (link.version !== body.association_version || (body.glossary_id !== effectiveId && !(link.id === null && body.glossary_id === null))) return failure('glossary_association_conflict', '项目术语表关联已变化，当前输入已保留。');
    if (method === 'PUT' && !suffix) {
      if (body.fork && link.id === null) {
        const id = randomUUID(), source = tables.get(organizationTableId);
        tables.set(id, { name: projectId === 7 ? 'Video' : 'Second', entries: (source?.entries ?? []).map(entry => ({ ...entry, id: randomUUID(), revision: 1 })) });
        link.id = id;
      } else if (body.use_organization_default && manage) link.id = null;
      else return failure('permission_denied', '当前无法切换术语表', 403);
      link.version++; return json(snapshot(projectId));
    }
    if (projectId !== null && link.id === null) return failure('organization_glossary_read_only', '请先创建项目副本。');
    if (projectId === null && !organizationTableId) {
      organizationTableId = randomUUID(); tables.set(organizationTableId, { name: '组织术语表', entries: [] });
    }
    const table = tables.get(projectId === null ? organizationTableId : link.id);
    let entry = suffix ? table.entries.find(row => row.id === suffix.split('/').at(-1)) : null;
    if (entry && entry.revision !== body.revision) return failure('glossary_conflict', '词条已被其他人修改。');
    if (!entry) { entry = { id: randomUUID(), revision: 0 }; table.entries.push(entry); }
    Object.assign(entry, { original: body.original.trim(), translation: body.translation.trim(), note: body.note.trim(), revision: entry.revision + 1,
      updated_by: { username: 'member' }, updated_at: '2026-11-12T00:00:00Z' });
    return json({ ...snapshot(projectId), entry });
  }
  unexpected.push(`${method} ${path}`); return route.abort();
});
const origin = process.env.GLOSSARY_URL || 'http://127.0.0.1:5227';
const page = await context.newPage(); page.setDefaultTimeout(12000); page.on('dialog', dialog => dialog.accept());
const panel = page.getByRole('complementary', { name: '术语表', exact: true });
const toggle = page.getByRole('button', { name: '术语表', exact: true });
const text = page.getByLabel('字幕中文文本');
const form = panel.getByRole('form', { name: '术语词条' });
const list = panel.locator('.glossary-entries');
const row = index => page.locator('.cue-text').nth(index);
const upperSize = () => page.evaluate(() => ['.workbench', '.video-stage', '.audio-timeline'].map(selector => {
  const box = document.querySelector(selector)?.getBoundingClientRect(); return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
}));
try {
  await page.goto(`${origin}/organizations/1/projects/7/workspace`); await row(0).waitFor();
  assert.equal(await panel.count(), 0); assert.equal(reads, 0);
  const videoNode = await page.locator('video').elementHandle();
  const dimensions = await upperSize();
  await toggle.click(); await panel.getByText('组织术语表还没有词条。').waitFor();
  assert.equal(await panel.getByRole('button', { name: '添加术语', exact: true }).count(), 0);
  assert.deepEqual(await upperSize(), dimensions);
  await row(0).click(); assert(await text.isDisabled());
  const organizationSettings = await context.newPage(); organizationSettings.setDefaultTimeout(10000);
  await organizationSettings.goto(`${origin}/organizations/1/settings/organization`);
  const organizationSection = organizationSettings.getByRole('region', { name: '组织术语表', exact: true });
  await organizationSection.getByRole('button', { name: '添加术语', exact: true }).click();
  const organizationForm = organizationSection.getByRole('form', { name: '术语词条' });
  await organizationForm.getByLabel('原词', { exact: true }).fill('Alice');
  await organizationForm.getByLabel('统一译名', { exact: true }).fill('爱丽丝');
  await organizationForm.getByRole('button', { name: '保存术语', exact: true }).click();
  await organizationSection.getByRole('cell', { name: '爱丽丝', exact: true }).waitFor();
  await organizationSection.getByText('此术语表被 3 个项目使用，修改后其他关联项目也会看到。').waitFor();
  const sourceEntryId = tables.get(organizationTableId).entries[0].id;
  await page.bringToFront(); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await list.getByText('爱丽丝', { exact: true }).waitFor();
  assert(await list.getByRole('button', { name: '编辑', exact: true }).isDisabled());
  await page.locator('.cue-list').evaluate(el => { el.style.maxHeight = '144px'; });
  const smallQuery = panel.getByLabel('查询原词、译名或备注'); await smallQuery.scrollIntoViewIfNeeded();
  const smallBounds = await smallQuery.boundingBox(), smallPanel = await panel.boundingBox();
  assert(smallBounds.y >= smallPanel.y - 1 && smallBounds.y + smallBounds.height <= smallPanel.y + smallPanel.height + 1);
  assert(await panel.evaluate(el => el.scrollHeight > el.clientHeight));
  await page.locator('.cue-list').evaluate(el => { el.style.maxHeight = ''; });
  failWrite = 'request_failed';
  await panel.getByRole('button', { name: '创建项目副本', exact: true }).click();
  await panel.getByText('保存失败，输入已保留。', { exact: false }).waitFor();
  assert.equal(tables.size, 1); assert.equal(links.get(7).id, null);
  await panel.getByRole('button', { name: '创建项目副本', exact: true }).click();
  await list.getByRole('button', { name: '编辑', exact: true }).waitFor();
  await list.getByRole('button', { name: '编辑', exact: true }).click();
  assert.notEqual(tables.get(links.get(7).id).entries[0].id, sourceEntryId);
  await form.getByLabel('原词', { exact: true }).fill('Alice');
  await form.getByLabel('统一译名', { exact: true }).fill('爱丽丝');
  await form.getByLabel('备注', { exact: true }).fill('<b>{\\b1} 人名');
  failWrite = 'request_failed';
  await form.getByRole('button', { name: '保存术语' }).click(); await form.getByText('保存失败，输入已保留。').waitFor();
  assert.equal(await form.getByLabel('统一译名', { exact: true }).inputValue(), '爱丽丝');
  const writesBeforeIme = requests.filter(req => req.method !== 'GET' && req.path.includes('/glossary')).length;
  await form.getByLabel('统一译名', { exact: true }).dispatchEvent('compositionstart', { data: '丽' });
  await form.getByLabel('统一译名', { exact: true }).focus(); await page.keyboard.press('Enter');
  assert.equal(requests.filter(req => req.method !== 'GET' && req.path.includes('/glossary')).length, writesBeforeIme);
  await form.getByLabel('统一译名', { exact: true }).dispatchEvent('compositionend', { data: '丽' });
  const pending = gate(); heldWrite = pending;
  await form.getByRole('button', { name: '保存术语' }).click(); await pending.started;
  assert(await form.getByRole('button', { name: '保存中…' }).isDisabled()); pending.release();
  await list.getByText('爱丽丝', { exact: true }).waitFor();
  assert.equal(tables.size, 2); assert.equal(tables.get(links.get(7).id).entries.length, 1);
  assert(await list.getByRole('button', { name: '插入', exact: true }).isDisabled());
  assert.equal(await list.locator('b').count(), 0);
  checks.push('organization settings first add; default project read-only; member forks current snapshot without video; failure preserves input; pending prevents duplicates; plain text display');

  await panel.getByLabel('查询原词、译名或备注').fill('aLiCe'); await list.getByText('爱丽丝', { exact: true }).waitFor();
  await panel.getByLabel('查询原词、译名或备注').fill('不存在'); await panel.getByText('没有匹配的术语。').waitFor();
  await panel.getByRole('button', { name: '添加术语', exact: true }).click();
  assert.equal(await form.getByLabel('原词', { exact: true }).inputValue(), '不存在'); await form.getByRole('button', { name: '取消' }).click();
  await panel.getByLabel('查询原词、译名或备注').fill(''); await list.getByText('爱丽丝', { exact: true }).waitFor();
  await list.getByRole('button', { name: '编辑', exact: true }).click();
  await form.getByLabel('备注', { exact: true }).fill('本地草稿');
  const firstTable = tables.get(links.get(7).id); firstTable.entries[0].note = '服务器修改'; firstTable.entries[0].revision++;
  await panel.getByRole('button', { name: '刷新术语表', exact: true }).click(); await list.getByText('服务器修改').waitFor();
  assert.equal(await form.getByLabel('备注', { exact: true }).inputValue(), '本地草稿');
  await form.getByRole('button', { name: '保存术语' }).click(); await form.getByRole('button', { name: '重新加载服务器内容' }).waitFor();
  assert.equal(await form.getByLabel('备注', { exact: true }).inputValue(), '本地草稿');
  await form.getByRole('button', { name: '重新加载服务器内容' }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="术语词条"] textarea')?.value === '服务器修改');
  await form.getByLabel('备注', { exact: true }).fill('已核对'); failRead = true;
  await form.getByRole('button', { name: '保存术语' }).click();
  await list.getByText('已核对').waitFor(); await panel.getByText('查询失败', { exact: false }).waitFor();
  await panel.getByRole('button', { name: '重试', exact: true }).click();
  await panel.getByText('查询失败', { exact: false }).waitFor({ state: 'detached' });
  failRead = true; await panel.getByRole('button', { name: '刷新术语表', exact: true }).click(); await panel.getByText('查询失败', { exact: false }).waitFor();
  assert.equal(await list.getByText('爱丽丝', { exact: true }).count(), 1);
  await panel.getByRole('button', { name: '重试', exact: true }).click(); await panel.getByText('查询失败', { exact: false }).waitFor({ state: 'detached' });
  const searchRace = gate(); heldRead = searchRace;
  await panel.getByLabel('查询原词、译名或备注').fill('迟到搜索'); await searchRace.started;
  await panel.getByLabel('查询原词、译名或备注').fill(''); await list.getByText('爱丽丝', { exact: true }).waitFor();
  searchRace.release();
  await panel.getByRole('button', { name: '刷新术语表', exact: true }).click(); await list.getByText('爱丽丝', { exact: true }).waitFor();
  checks.push('literal search/prefill; refresh retains drafts/data; entry CAS conflict reloads only by explicit action');

  // QC and glossary share one rail and preserve the upper layout.
  await page.getByRole('button', { name: '字幕质量检查', exact: true }).click();
  await page.getByRole('complementary', { name: '字幕质量检查' }).waitFor(); assert.equal(await panel.count(), 0);
  await toggle.click(); await panel.waitFor(); assert.equal(await page.getByRole('complementary', { name: '字幕质量检查' }).count(), 0);
  const boxes = await Promise.all([page.locator('.cue-table-pane').boundingBox(), panel.boundingBox()]);
  assert(boxes[0].width >= 740 && boxes[1].width >= 320); assert.deepEqual(await upperSize(), dimensions);
  await page.screenshot({ path: join(output, 'desktop.png') });
  await page.setViewportSize({ width: 800, height: 900 });
  assert.equal(await page.locator('.cue-table-pane').isVisible(), false);
  await page.screenshot({ path: join(output, 'narrow.png') });
  // Search opens the subtitle list again on narrow screens.
  await page.getByRole('button', { name: '查找字幕', exact: true }).click();
  assert.equal(await panel.count(), 0); assert(await page.locator('.cue-table-pane').isVisible());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: '查找字幕', exact: true }).click();
  await toggle.click(); await list.getByText('爱丽丝', { exact: true }).waitFor();
  checks.push('QC/glossary mutual exclusion; wide rail and narrow switch; video/audio geometry unchanged');

  await page.getByLabel('导入本地视频').setInputFiles(videoFile);
  await page.waitForFunction(() => !document.querySelector('textarea[aria-label="字幕中文文本"]')?.disabled);
  await text.click(); await text.evaluate(input => { input.setSelectionRange(1, 2); input.dispatchEvent(new Event('select', { bubbles: true })); });
  await list.getByRole('button', { name: '插入', exact: true }).click();
  assert.equal(await text.inputValue(), '甲爱丽丝丙'); assert(await text.evaluate(input => document.activeElement === input && input.selectionStart === 4));
  await page.locator('main').focus(); await page.keyboard.press('Control+z'); assert.equal(await text.inputValue(), '甲乙丙');
  await page.keyboard.press('Control+Shift+z'); assert.equal(await text.inputValue(), '甲爱丽丝丙');
  await row(1).click(); await list.getByRole('button', { name: '插入', exact: true }).click();
  assert.equal(await text.inputValue(), '第二行爱丽丝');
  await text.evaluate(input => { input.setSelectionRange(1, 1); input.dispatchEvent(new Event('select', { bubbles: true })); });
  await list.getByRole('button', { name: '插入', exact: true }).click(); assert.equal(await text.inputValue(), '第爱丽丝二行爱丽丝');
  // Composition remains guarded even with a panel click; panel keys never reach timing/history.
  await text.dispatchEvent('compositionstart', { data: '中' });
  await list.getByRole('button', { name: '插入', exact: true }).click(); assert.equal(await text.inputValue(), '第爱丽丝二行爱丽丝');
  await text.dispatchEvent('compositionend', { data: '中' });
  await panel.getByLabel('查询原词、译名或备注').evaluate(input => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true, cancelable: true })));
  assert.equal(await page.locator('[data-cue-search] input').count(), 0);
  const beforeKeys = await text.inputValue();
  await panel.getByLabel('查询原词、译名或备注').focus(); await page.keyboard.press('g'); await page.keyboard.press('Control+z');
  assert.equal(await text.inputValue(), beforeKeys); assert.equal(await page.locator('.cue-text').count(), 2);
  await panel.getByLabel('查询原词、译名或备注').fill('');
  assert(await videoNode.evaluate(node => node === document.querySelector('video')));
  assert.equal(requests.filter(req => /\/document$|\/split$|\/styles$/.test(req.path) && req.method !== 'GET').length, 0);
  const beforePlayback = reads;
  await page.locator('video').evaluate(video => { video.currentTime = 3; video.dispatchEvent(new Event('timeupdate')); });
  await text.fill('独立字幕草稿'); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(reads, beforePlayback);
  checks.push('caret/selection replacement; row cursor isolation; focus restoration; one-step undo/redo; IME and shortcut guards; no subtitle save/remount/playback requests');

  // Organization edits update default readers, never either project snapshot.
  await organizationSettings.bringToFront();
  await organizationSection.getByRole('button', { name: '编辑', exact: true }).click();
  await organizationForm.getByLabel('统一译名', { exact: true }).fill('组织新译名');
  await organizationForm.getByRole('button', { name: '保存术语', exact: true }).click();
  await organizationSection.getByRole('cell', { name: '组织新译名', exact: true }).waitFor();
  await organizationSection.getByRole('button', { name: '添加术语', exact: true }).click();
  await organizationForm.getByLabel('原词', { exact: true }).fill('Organization only');
  await organizationForm.getByLabel('统一译名', { exact: true }).fill('组织新增');
  await organizationForm.getByRole('button', { name: '保存术语', exact: true }).click();
  await organizationSection.getByRole('cell', { name: '组织新增', exact: true }).waitFor();
  await organizationSettings.setViewportSize({ width: 760, height: 900 });
  assert(await organizationSettings.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await organizationSettings.screenshot({ path: join(output, 'organization-settings.png'), fullPage: true });
  const settings = await context.newPage(); settings.setDefaultTimeout(10000);
  await settings.goto(`${origin}/organizations/1/projects/8/settings`);
  const section = settings.getByRole('region', { name: '项目术语表' });
  await section.getByRole('cell', { name: '组织新译名', exact: true }).waitFor();
  assert.equal(await section.getByRole('button', { name: '添加术语', exact: true }).count(), 0);
  await section.getByRole('button', { name: '创建项目副本', exact: true }).click();
  const aliceRow = section.getByRole('row').filter({ hasText: 'Alice' });
  await aliceRow.getByRole('button', { name: '编辑', exact: true }).click();
  await section.getByRole('form', { name: '术语词条' }).getByLabel('统一译名', { exact: true }).fill('第二项目译名');
  await section.getByRole('button', { name: '保存术语', exact: true }).click();
  await section.getByRole('cell', { name: '第二项目译名', exact: true }).waitFor();
  assert.equal(tables.get(organizationTableId).entries[0].translation, '组织新译名');
  await page.bringToFront(); await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await list.getByText('爱丽丝', { exact: true }).waitFor(); assert.equal(await text.inputValue(), '独立字幕草稿');
  assert.equal(await list.getByText('组织新增', { exact: true }).count(), 0);
  await settings.close(); manage = true;
  const admin = await context.newPage(); admin.setDefaultTimeout(10000);
  await admin.goto(`${origin}/organizations/1/projects/8/settings`);
  const adminSection = admin.getByRole('region', { name: '项目术语表' });
  await adminSection.getByRole('row').filter({ hasText: 'Alice' }).getByRole('button', { name: '编辑', exact: true }).click();
  await adminSection.getByRole('form', { name: '术语词条' }).getByLabel('备注', { exact: true }).fill('切换前的未保存输入');
  await adminSection.getByRole('button', { name: '使用组织术语表', exact: true }).click();
  await adminSection.getByRole('button', { name: '取消', exact: true }).click();
  await adminSection.getByRole('cell', { name: '组织新译名', exact: true }).waitFor();
  assert.equal(links.get(8).id, null); assert.equal(tables.size, 3);
  await admin.setViewportSize({ width: 760, height: 900 }); await admin.screenshot({ path: join(output, 'settings-narrow.png') });
  checks.push('organization settings maintenance; defaults share latest terms including archives; independent snapshots neither read new terms nor write back; admin revert retains old snapshot');

  await admin.goto(`${origin}/organizations/1/projects/9/workspace`);
  await admin.getByRole('button', { name: '术语表', exact: true }).click();
  const archived = admin.getByRole('complementary', { name: '术语表', exact: true });
  await archived.getByText('组织新译名', { exact: true }).waitFor();
  assert.equal(await archived.getByRole('button', { name: '添加术语' }).count(), 0);
  assert.equal(await archived.getByRole('button', { name: '创建项目副本' }).count(), 0);
  assert(await archived.getByRole('button', { name: '编辑', exact: true }).first().isDisabled());
  assert(await archived.getByRole('button', { name: '插入', exact: true }).first().isDisabled());
  await admin.close(); await organizationSettings.close();
  const late = gate(); heldRead = late;
  await panel.getByRole('button', { name: '刷新术语表', exact: true }).click(); await late.started;
  await toggle.click(); late.release();
  await toggle.click(); await list.getByText('爱丽丝', { exact: true }).waitFor();
  assert.equal(await text.inputValue(), '独立字幕草稿');
  checks.push('archived context reads latest shared data; no writes/insert; unmounted delayed response cannot revive panel');

  const independentId = [...tables.keys()].find(id => id !== links.get(7).id && id !== organizationTableId);
  tables.get(independentId).entries = [{ ...firstTable.entries[0], id: randomUUID(), translation: '另表' }];
  links.get(8).id = independentId; links.get(8).version++;
  const oldProjectRead = gate(); heldRead = oldProjectRead;
  await panel.getByRole('button', { name: '刷新术语表', exact: true }).click(); await oldProjectRead.started;
  await sameTab(page.getByRole('link', { name: '项目列表', exact: true }));
  await sameTab(page.getByRole('link', { name: 'Second', exact: true }));
  await page.getByRole('button', { name: '明确放弃并继续', exact: true }).click();
  await row(0).waitFor(); await toggle.click(); await list.getByText('另表', { exact: true }).waitFor();
  oldProjectRead.release();
  await panel.getByRole('button', { name: '刷新术语表', exact: true }).click(); await list.getByText('另表', { exact: true }).waitFor();
  assert.equal(await list.getByText('艾莉丝', { exact: true }).count(), 0);

  const oldAccountRead = gate(); heldRead = oldAccountRead;
  await panel.getByRole('button', { name: '刷新术语表', exact: true }).click(); await oldAccountRead.started;
  sessionUser = { id: 2, username: 'next-member', is_dev: false };
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('dialog', { name: '切换到账号 next-member', exact: true }).waitFor();
  await page.getByRole('button', { name: '明确放弃并继续', exact: true }).click();
  await page.getByRole('link', { name: 'Second', exact: true }).waitFor();
  tables.get(independentId).entries[0].translation = '新账号内容';
  oldAccountRead.release();
  await sameTab(page.getByRole('link', { name: 'Second', exact: true }));
  await row(0).waitFor(); await toggle.click(); await list.getByText('新账号内容', { exact: true }).waitFor();
  assert.equal(await list.getByText('另表', { exact: true }).count(), 0);
  const revokedRead = gate(); heldRead = revokedRead;
  await panel.getByRole('button', { name: '刷新术语表', exact: true }).click(); await revokedRead.started;
  denyRead = true; await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await panel.getByText('已无权访问术语表。', { exact: false }).waitFor(); revokedRead.release();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await list.count(), 0); denyRead = false;
  checks.push('stale project/account responses isolated after real App transitions; newer revocation clears old data');

  const local = await context.newPage(); await local.goto(`${origin}/workspace/local`); await local.locator('.cue-text').first().waitFor();
  assert.equal(await local.getByRole('button', { name: '术语表', exact: true }).count(), 0); await local.close();
  assert.equal(unexpected.length, 0, unexpected.join('\n')); assert.equal(errors.length, 0, errors.join('\n'));
  assert.equal(requests.filter(req => /\/document$/.test(req.path)).length, 0);
  writeFileSync(join(output, 'results.json'), JSON.stringify({ checks, reads, requests: requests.length, errors, unexpected }, null, 2));
  console.log(JSON.stringify({ output, checks, reads, requests: requests.length }, null, 2));
} catch (error) { await page.screenshot({ path: join(output, 'failure.png') }); writeFileSync(join(output, 'failure.html'), await page.content()); console.error(`Artifacts: ${output}`); throw error; }
finally { await browser.close(); }
