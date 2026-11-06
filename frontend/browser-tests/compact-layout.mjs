// Real Chrome, generated media and isolated HTTP fixtures; no development database writes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { uiDocument } from './ass-codec.mjs';
import { unavailableAssPreview } from './ass-preview-fixture.mjs';
import { sameTab } from './link-navigation.mjs';

const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-compact-layout-'));
const file = join(artifacts, 'video.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
  'color=c=black:s=160x90:r=10:d=8', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
const bytes = readFileSync(file), documentFixture = uiDocument();
documentFixture.cues = Array.from({ length: 40 }, (_, index) => ({ id: `cue-${index}`, start_ms: index * 100,
  end_ms: index * 100 + 100, style_id: documentFixture.styles[0].id, text: `字幕 ${index + 1}` }));
let project = { id: 7, organization_id: 1, name: '布局验证项目', description: '', status: 'active', revision: 3,
  media: { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), duration_ms: 8000 }, document: documentFixture };
let settings = { shortcut_overrides: {}, audio_display_mode: 'spectrum', mouse_sets_cue_boundary: true }, rejectSave = true;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const errors = [], unexpected = [], checks = [];
context.on('page', page => page.on('pageerror', error => errors.push(String(error))));
await context.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  if (await unavailableAssPreview(route)) return;
  if (path === '/api/organizations/1/projects/7/document') {
    if (rejectSave) { rejectSave = false; return route.fulfill({ status: 409, json: { error: { code: 'revision_conflict', message: '保存冲突，请重新检查项目版本。' } } }); }
    project = { ...project, document: request.postDataJSON().document, revision: project.revision + 1 };
    return route.fulfill({ json: { project } });
  }
  if (path === '/api/me/settings' && request.method() === 'PATCH') {
    settings = { ...settings, ...request.postDataJSON() }; return route.fulfill({ json: settings });
  }
  const fixtures = {
    '/api/auth/session': { user: { id: 1, username: 'layout', is_dev: false } },
    '/api/organizations': { organizations: [{ id: 1, name: '布局组织', role: 'organizer', can_manage: true }] },
    '/api/me/settings': settings, '/api/ass/empty': { document: documentFixture },
    '/api/organizations/1/projects/7': { project },
    '/api/organizations/1/projects': { projects: [], total: 0, page: 1, has_more: false },
    '/api/organizations/1/members': { members: [] },
  };
  if (fixtures[path]) return route.fulfill({ json: fixtures[path] });
  unexpected.push(`${request.method()} ${path}`); return route.abort();
});
const page = await context.newPage();
page.setDefaultTimeout(10000); page.on('dialog', dialog => dialog.accept());
const origin = process.env.COMPACT_LAYOUT_URL || 'http://127.0.0.1:5173';
const main = page.locator('main.editor-workbench'), text = page.getByLabel('字幕中文文本');
const header = page.locator('main:visible .app-header');
const listHeight = async () => (await page.locator('.cue-list').boundingBox()).height;
async function compactHeader() { assert.equal((await header.boundingBox()).height, 44); }
async function oneFieldRow() {
  const controls = [page.getByRole('textbox', { name: '入点', exact: true }), page.getByRole('textbox', { name: '出点', exact: true }), page.getByLabel('字幕样式', { exact: true })];
  const boxes = await Promise.all(controls.map(control => control.boundingBox()));
  assert(Math.max(...boxes.map(box => box.y)) - Math.min(...boxes.map(box => box.y)) < 2);
}
try {
  await page.goto(`${origin}/organizations/1/projects/7/workspace`);
  await page.locator('.cue-list tbody tr').first().waitFor();
  await compactHeader(); await oneFieldRow();
  assert.equal(await page.getByText('请选择与项目基准一致的本地视频；完整校验通过后可编辑和保存。', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '导出诊断信息', exact: true }).count(), 0);
  assert(await page.getByRole('button', { name: '保存项目', exact: true }).isDisabled());
  const compactHeight = await listHeight();
  // The 12px header reduction and 52px editor reduction belong to the subtitle list.
  const previousSizing = await page.addStyleTag({ content: '.app-header { flex-basis:56px; height:56px } .workbench { flex-basis:clamp(400px,54dvh,560px) }' });
  const previousHeight = await listHeight(); await previousSizing.evaluate(style => style.remove());
  assert(Math.abs(compactHeight - previousHeight - 64) < 1);
  await page.getByLabel('导入本地视频').setInputFiles(file);
  await header.getByText('字幕已保存。', { exact: true }).waitFor();
  assert.equal(await listHeight(), compactHeight);
  await page.getByRole('button', { name: '选择第 1 行', exact: true }).click(); await text.fill('布局测试的未保存字幕');
  await header.getByText('存在尚未保存的字幕修改，请点击保存项目。', { exact: true }).waitFor();
  assert.equal(await listHeight(), compactHeight);
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await header.getByRole('alert').waitFor(); assert.equal(await listHeight(), compactHeight);
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await page.getByRole('button', { name: '保存项目', exact: true }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('.file-actions .primary')?.disabled);
  assert.equal(await listHeight(), compactHeight); await compactHeader();
  await page.screenshot({ path: join(artifacts, 'workspace-1440.png') });
  checks.push(`1440×900: 44px header, one field row, subtitle list gains 64px from sizing alone (${previousHeight} → ${compactHeight}); verification/edit/error/save cause no height change`);

  for (const viewport of [{ width: 1024, height: 768 }, { width: 1440, height: 600 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport); await compactHeader(); await oneFieldRow();
    assert(await text.isVisible());
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (viewport.width > 900) assert((await page.locator('.cue-list').boundingBox()).height >= 144);
    await page.screenshot({ path: join(artifacts, `workspace-${viewport.width}x${viewport.height}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  checks.push('1024px desktop, 600px short window and 390px narrow layout retain a 44px header, one field row and local overflow');

  await sameTab(page.getByRole('link', { name: '设置', exact: true })); await main.waitFor({ state: 'hidden' });
  const exportButton = page.getByRole('button', { name: '导出诊断信息', exact: true }); await exportButton.waitFor();
  assert.equal(await header.getByRole('button', { name: '导出诊断信息', exact: true }).count(), 0);
  assert.equal(await page.getByText(/不包含密码等认证/).count(), 0); await compactHeader();
  assert.equal(await header.getByText('字幕已保存。', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '保存显示设置', exact: true }).click();
  await header.getByText('已保存', { exact: true }).waitFor(); await compactHeader();
  await page.evaluate(() => { window.originalCreateURL = URL.createObjectURL; URL.createObjectURL = () => { throw Error('fixture download failure'); }; });
  await exportButton.click(); await header.getByText('诊断信息导出失败，请重试。', { exact: true }).waitFor(); await compactHeader();
  await page.evaluate(() => { URL.createObjectURL = window.originalCreateURL; });
  const downloaded = page.waitForEvent('download'); await exportButton.click();
  const download = await downloaded, report = JSON.parse(readFileSync(await download.path(), 'utf8'));
  assert.equal(report.environment.account.username, 'layout');
  assert.equal(await header.getByText('诊断信息导出失败，请重试。', { exact: true }).count(), 0);
  await page.screenshot({ path: join(artifacts, 'personal-settings.png'), fullPage: true });
  await sameTab(page.getByRole('link', { name: '组织设置', exact: true }));
  await page.getByLabel('组织名称').waitFor(); await compactHeader(); assert.equal(await exportButton.count(), 0);
  await page.goBack(); await exportButton.waitFor(); await page.goBack(); await main.waitFor({ state: 'visible' });
  assert.equal(await text.inputValue(), '布局测试的未保存字幕');
  checks.push('personal settings owns diagnostics entry and download retry; settings feedback stays in header; organization page has no export; retained workspace messages/state stay isolated');

  for (const route of ['/organizations/1/projects', '/organizations/1/projects/7/settings', '/missing']) {
    const view = await context.newPage(); await view.goto(`${origin}${route}`);
    await view.locator('.app-header').waitFor(); assert.equal((await view.locator('.app-header').boundingBox()).height, 44);
    assert.equal(await view.getByRole('button', { name: '导出诊断信息', exact: true }).count(), 0); await view.close();
  }
  const anonymous = await browser.newContext();
  let sessionFailed = true;
  await anonymous.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session' && !sessionFailed) return route.fulfill({ json: { user: null } });
    return route.fulfill({ status: sessionFailed ? 503 : 401, json: { error: { code: 'unavailable', message: sessionFailed ? '会话检查失败' : '登录信息无效' } } });
  });
  const login = await anonymous.newPage(); await login.goto(`${origin}/workspace/local`);
  await login.locator('.app-header').getByText('会话检查失败', { exact: false }).waitFor();
  sessionFailed = false; await login.getByRole('button', { name: '刷新会话与设置', exact: true }).click();
  await login.getByLabel('用户名', { exact: true }).fill('fixture'); await login.getByLabel('密码', { exact: true }).fill('fixture');
  await login.getByRole('button', { name: '登录', exact: true }).click();
  await login.locator('.app-header').getByText('登录信息无效', { exact: true }).waitFor();
  assert.equal((await login.locator('.app-header').boundingBox()).height, 44);
  assert.equal(await login.getByRole('button', { name: '导出诊断信息', exact: true }).count(), 0);
  await anonymous.close();
  checks.push('lists, project settings, unknown route and login use the compact header; anonymous session failures retain a visible retry and login errors stay in the header');
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  const result = { browser: browser.version(), checks, errors, unexpected };
  writeFileSync(join(artifacts, 'report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ artifacts, ...result }, null, 2));
} finally { await browser.close(); }
