// Single-page creation and the native bubbling file-input cancel event boundary.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const password = process.env.BROWSER_TEST_PASSWORD;
if (!password) throw new Error('Set BROWSER_TEST_PASSWORD and seed disposable project fixtures');
const baseURL = process.env.PROJECTS_URL || 'http://127.0.0.1:5196';
const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-project-form-'));
const video = join(artifacts, 'video.mp4');
const ass = fileURLToPath(new URL('../../backend/ass_format/fixtures/basic.ass', import.meta.url));
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
writeFileSync(join(artifacts, 'invalid.ass'), 'invalid subtitle');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
context.setDefaultTimeout(15000);
const page = await context.newPage();
const errors = [], checks = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('dialog', dialog => { if (dialog.type() === 'beforeunload') void dialog.accept(); else void dialog.dismiss(); });
const modal = page.getByRole('dialog', { name: '新建项目', exact: true });
const record = label => { checks.push(label); console.log('PASS', label); };
async function open() { await page.getByRole('button', { name: '新建项目', exact: true }).click(); await modal.waitFor(); }
async function checkFields(name, description) {
  assert(await modal.isVisible());
  assert.equal(await page.getByLabel('项目名称', { exact: true }).inputValue(), name);
  assert.equal(await page.getByLabel('项目说明', { exact: true }).inputValue(), description);
}
async function cancelPicker(input) {
  // An empty intercepted chooser exercises the no-selection change path.
  const chooser = page.waitForEvent('filechooser'); await input.click(); await (await chooser).setFiles([]);
  // Native file input cancel bubbles. Dispatch the exact event that previously
  // reached Modal.onCancel; the baseline was reproduced before the fix.
  await input.dispatchEvent('cancel', { bubbles: true, cancelable: false });
}
try {
  await page.goto('/');
  await page.getByLabel('用户名', { exact: true }).fill('project-organizer');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '项目', exact: true }).waitFor();
  const listURL = page.url(); const tabs = context.pages().length;
  await open();
  assert.equal(page.url(), listURL); assert.equal(context.pages().length, tabs);
  for (const name of ['项目名称', '项目说明', '基准视频', '初始字幕']) await page.getByLabel(name, { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^(下一步|上一步)$/ }).count(), 0);
  assert(await modal.getByRole('button', { name: '创建并打开', exact: true }).isDisabled());
  await page.getByLabel('项目名称', { exact: true }).fill('取消选片保留名称');
  await page.getByLabel('项目说明', { exact: true }).fill('取消选片保留说明');
  await cancelPicker(page.getByLabel('基准视频', { exact: true }));
  await checkFields('取消选片保留名称', '取消选片保留说明');
  await modal.getByRole('button', { name: '取消', exact: true }).click(); await modal.waitFor({ state: 'hidden' });
  await open();
  await checkFields('', '');
  await page.keyboard.press('Escape'); await modal.waitFor({ state: 'hidden' });
  record('新建只在当前列表弹窗，所有字段一次显示；取消视频选择保留名称/说明，明确取消与弹窗 Escape 仍可关闭');

  await open();
  const title = `单页创建 ${Date.now()}`; const description = '名称、说明、视频、字幕均在同一表单';
  await page.getByLabel('项目名称', { exact: true }).fill(title);
  await page.getByLabel('项目说明', { exact: true }).fill(description);
  await page.getByLabel('基准视频', { exact: true }).setInputFiles(video);
  await page.getByText(/完整校验通过/).waitFor();
  await cancelPicker(page.getByLabel('基准视频', { exact: true }));
  await checkFields(title, description); await page.getByText(/video.mp4.*完整校验通过/).waitFor();
  await page.getByLabel('初始字幕', { exact: true }).selectOption('import');
  await page.getByLabel('ASS 文件', { exact: true }).setInputFiles(join(artifacts, 'invalid.ass'));
  await modal.getByRole('alert').waitFor();
  await checkFields(title, description);
  assert(await modal.getByRole('button', { name: '创建并打开', exact: true }).isDisabled());
  await page.getByLabel('ASS 文件', { exact: true }).setInputFiles(ass);
  await page.getByText(/字幕预检通过/).waitFor();
  await cancelPicker(page.getByLabel('ASS 文件', { exact: true }));
  await checkFields(title, description); await page.getByText(/basic.ass.*字幕预检通过/).waitFor();
  assert(await modal.getByRole('button', { name: '创建并打开', exact: true }).isEnabled());
  await page.evaluate(() => { window.__creationDialog = document.querySelector('dialog'); });
  const refreshed = page.waitForResponse(response => response.url().endsWith('/api/organizations'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await refreshed;
  await checkFields(title, description);
  assert(await modal.evaluate(dialog => dialog === window.__creationDialog));
  await page.getByLabel('项目名称', { exact: true }).fill(title + ' 已核对');
  await page.getByLabel('项目说明', { exact: true }).fill(description + '，选片后仍可修改');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(artifacts, `form-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  record('已选视频/字幕再次取消不清除有效选择；非法 ASS 保留表单且禁止创建；窗口重新聚焦不重建弹窗；选片后可继续改名称说明');

  const orgs = await (await context.request.get('/api/organizations')).json();
  const org = orgs.organizations.find(value => value.role === 'organizer');
  const apiPath = `/api/organizations/${org.id}/projects`;
  let received; const requested = new Promise(resolve => { received = resolve; });
  let release; const held = new Promise(resolve => { release = resolve; });
  await page.route('**' + apiPath, async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    received(); await held;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unavailable', message: '测试创建失败，请重试' } }) });
  });
  await modal.getByRole('button', { name: '创建并打开', exact: true }).click(); await requested;
  await page.keyboard.press('Escape'); assert(await modal.isVisible());
  release(); await page.getByText('测试创建失败，请重试', { exact: true }).waitFor();
  await checkFields(title + ' 已核对', description + '，选片后仍可修改');
  await page.getByText(/完整校验通过/).waitFor(); await page.getByText(/字幕预检通过/).waitFor();
  const listing = await (await context.request.get(apiPath)).json();
  assert(!listing.projects.some(value => value.name.startsWith(title)));
  await page.unroute('**' + apiPath);
  await modal.getByRole('button', { name: '创建并打开', exact: true }).click();
  await page.waitForURL(/\/projects\/\d+\/workspace$/);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  assert.equal(context.pages().length, tabs);
  assert(await page.locator('video').evaluate(video => video.src.startsWith('blob:')));
  await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  assert(await page.getByLabel('字幕中文文本').isEnabled());
  const projectPath = new URL(page.url()).pathname;
  const detail = (await (await context.request.get('/api' + projectPath.replace(/\/workspace$/, ''))).json()).project;
  assert.equal(detail.name, title + ' 已核对'); assert.equal(detail.description, description + '，选片后仍可修改');
  record('创建中不能误关弹窗；创建失败不丢表单且不留项目；重试在当前 tab 打开工作区并直接复用所选 File');
  await page.goBack(); await page.getByRole('heading', { name: '项目', exact: true }).waitFor();
  assert.equal(page.url(), listURL); assert.equal(await modal.count(), 0);
  await page.goForward(); await page.getByLabel('字幕中文文本').waitFor();
  assert(await page.locator('video').evaluate(video => video.src.startsWith('blob:')));
  const legacy = await context.newPage();
  await legacy.goto(`/organizations/${org.id}/projects/new`);
  await legacy.waitForURL(`**/organizations/${org.id}/projects`);
  await legacy.getByRole('heading', { name: '项目', exact: true }).waitFor();
  assert.equal(await legacy.getByRole('dialog', { name: '新建项目', exact: true }).count(), 0);
  record('创建后回退返回列表、前进保留工作区；旧创建 URL 规范到组织列表');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: browser.version(), checks, errors, artifacts }, null, 2));
} catch (error) {
  console.error(error, 'URL', page.url());
  await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }).catch(() => {}); throw error;
} finally { await context.close(); await browser.close(); }
