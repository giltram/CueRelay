// Native browser navigation against real Session/CSRF/project APIs. No media uploads.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const password = process.env.BROWSER_TEST_PASSWORD;
if (!password) throw new Error('Set BROWSER_TEST_PASSWORD and seed a disposable navigation database');
const baseURL = process.env.PROJECTS_URL || 'http://127.0.0.1:5191';
const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-navigation-'));
const videoFile = join(artifacts, 'navigation.mp4');
const assFixture = fileURLToPath(new URL('../../backend/ass_format/fixtures/basic.ass', import.meta.url));
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=30',
  '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', videoFile]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ baseURL, acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
context.setDefaultTimeout(15000);
const errors = [];
const uploads = [];
const checks = [];
function watch(page) {
  page.on('pageerror', error => errors.push(String(error)));
  page.on('dialog', dialog => { if (dialog.type() === 'beforeunload') void dialog.accept(); else void dialog.dismiss(); });
}
context.on('page', watch);
context.on('request', request => {
  if (request.method() !== 'GET') uploads.push(request.headers()['content-type']);
});
const page = await context.newPage();
const record = label => { checks.push(label); console.log('PASS', label); };
const modal = (title, target = page) => target.getByRole('dialog', { name: title, exact: true });
const workspace = target => target.getByLabel('字幕中文文本');
async function login(target, name = 'project-organizer') {
  await target.getByLabel('用户名', { exact: true }).fill(name);
  await target.getByLabel('密码', { exact: true }).fill(password);
  await target.getByRole('button', { name: '登录', exact: true }).click();
  await target.locator('.login-page').waitFor({ state: 'hidden' });
}
async function api(path, method = 'GET', data, target = context) {
  await target.request.get('/api/auth/session');
  const token = (await target.cookies()).find(cookie => cookie.name === 'csrftoken').value;
  const response = await target.request.fetch('/api' + path, { method, data, headers: { 'X-CSRFToken': token } });
  assert(response.ok(), `${method} ${path}: ${await response.text()}`);
  return response.json();
}
async function newTab(link, options) {
  const opened = context.waitForEvent('page');
  await link.click(options);
  const tab = await opened;
  await tab.waitForLoadState('domcontentloaded');
  return tab;
}
async function draftSnapshot() {
  return page.evaluate(() => ({
    sameVideo: window.__navigationVideo === document.querySelector('video'),
    sameInput: window.__navigationStart === document.querySelector('input[aria-label="入点"]'),
    src: document.querySelector('video').src,
    start: document.querySelector('input[aria-label="入点"]').value,
    end: document.querySelector('input[aria-label="出点"]').value,
    text: document.querySelector('textarea').value,
    selected: document.querySelector('tr.selected')?.textContent,
    mode: document.querySelector('.audio-timeline').dataset.mode,
  }));
}
try {
  await page.goto('/'); await login(page);
  const organizations = (await api('/organizations')).organizations;
  const org = organizations.find(value => value.role === 'organizer');
  const otherOrg = organizations.find(value => value.id !== org.id);
  const listPath = `/organizations/${org.id}/projects`;
  await page.waitForURL(new URL('/', baseURL).href);
  await page.getByRole('link', { name: '项目列表', exact: true }).click();
  await page.waitForURL('**' + listPath);
  const title = `导航 ${Date.now()}`;
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByLabel('项目名称', { exact: true }).fill(title);
  await modal('新建项目').getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByLabel('基准视频', { exact: true }).setInputFiles(videoFile);
  await page.getByText(/完整校验通过/).waitFor();
  await page.getByLabel('初始字幕', { exact: true }).selectOption('import');
  await page.getByLabel('ASS 文件', { exact: true }).setInputFiles(assFixture);
  await page.getByText(/字幕预检通过/).waitFor();
  await modal('新建项目').getByRole('button', { name: '创建并打开', exact: true }).click();
  await page.waitForURL(/\/projects\/\d+\/workspace$/);
  const project = (await api(listPath)).projects.find(value => value.name === title);
  const projectPath = `${listPath}/${project.id}/workspace`;
  await page.waitForURL('**' + projectPath);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  await workspace(page).fill('导航未保存字幕');
  await page.getByLabel('入点', { exact: true }).fill('0:00:00.30');
  await page.getByRole('button', { name: 'Waveform', exact: true }).click();
  await page.locator('video').evaluate(video => { video.currentTime = 1.25; });
  await page.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 1.25) < 0.01);
  await page.evaluate(() => {
    window.__navigationVideo = document.querySelector('video');
    window.__navigationStart = document.querySelector('input[aria-label="入点"]');
  });
  const snapshot = await draftSnapshot();
  assert(snapshot.src.startsWith('blob:')); assert(snapshot.sameVideo && snapshot.sameInput);
  assert.deepEqual(Object.keys(await page.evaluate(() => history.state)), ['cueRelayNavigation']);
  record('创建后进入项目 URL，创建时的 File 直接启用编辑；历史仅含导航标记');

  const home = page.getByRole('link', { name: 'CueRelay', exact: true });
  assert.equal(await home.getAttribute('href'), '/');
  await home.click(); await page.waitForURL(new URL('/', baseURL).href);
  await page.getByRole('heading', { name: '项目', exact: true }).waitFor();
  assert.equal(await modal('打开其他项目').count(), 0);
  await page.goBack(); await page.waitForURL('**' + projectPath); await workspace(page).waitFor();
  assert.deepEqual(await draftSnapshot(), snapshot);
  record('点击 CueRelay 返回并保持 / 首页，浏览器回退恢复原工作区和未保存草稿');

  await page.goBack(); await page.waitForURL('**' + listPath); await page.getByRole('heading', { name: '项目', exact: true }).waitFor();
  await page.getByRole('heading', { name: '项目', exact: true }).waitFor();
  assert.equal(await modal('打开其他项目').count(), 0);
  assert(await page.locator('video').evaluate(video => video.paused));
  await page.goForward(); await page.waitForURL('**' + projectPath);
  await workspace(page).waitFor({ state: 'visible' });
  assert.deepEqual(await draftSnapshot(), snapshot);
  assert.equal(await page.locator('video').evaluate(video => video.currentTime), 1.25);
  await page.goBack(); await page.waitForURL('**' + listPath); await page.getByRole('heading', { name: '项目', exact: true }).waitFor();
  const titleLink = page.getByRole('link', { name: title, exact: true });
  assert.equal(await titleLink.getAttribute('href'), projectPath);
  await titleLink.click(); await workspace(page).waitFor({ state: 'visible' });
  assert.deepEqual(await draftSnapshot(), snapshot);
  record('回退回列表、前进和点击同项目均保留 video、播放位置、草稿、选择和显示模式');

  await page.locator('video').evaluate(async video => { video.muted = true; await video.play(); });
  const beforePlaying = await page.locator('video').evaluate(video => video.currentTime);
  const listLink = page.getByRole('link', { name: '项目列表', exact: true });
  assert.equal(await listLink.getAttribute('target'), '_blank');
  assert.equal(await listLink.getAttribute('href'), listPath);
  const listTab = await newTab(listLink);
  await listTab.getByRole('heading', { name: '项目', exact: true }).waitFor();
  assert.equal(await listTab.locator('video').count(), 0);
  await page.waitForFunction(time => document.querySelector('video').currentTime > time + 0.1, beforePlaying);
  assert.equal(await page.locator('video').evaluate(video => video.paused), false);
  assert.deepEqual(await draftSnapshot(), snapshot);
  assert.equal(new URL(page.url()).pathname, projectPath);
  await page.locator('video').evaluate(video => video.pause());
  record('工作区原生新开列表不隐藏或暂停原视频，字幕/草稿/节点保持，播放位置继续推进');

  const tabProjectLink = listTab.getByRole('link', { name: title, exact: true });
  const middleTab = await newTab(tabProjectLink, { button: 'middle' });
  await workspace(middleTab).waitFor(); assert(await workspace(middleTab).isDisabled());
  assert.equal(await middleTab.locator('video').getAttribute('src'), null);
  const modifierTab = await newTab(tabProjectLink, { modifiers: ['ControlOrMeta'] });
  await workspace(modifierTab).waitFor(); assert(await workspace(modifierTab).isDisabled());
  await listTab.getByRole('row').filter({ has: tabProjectLink }).getByRole('link', { name: '打开', exact: true }).click();
  await workspace(listTab).waitFor();
  assert(await workspace(listTab).isDisabled());
  await listTab.reload(); await workspace(listTab).waitFor();
  assert.equal(new URL(listTab.url()).pathname, projectPath);
  assert(await workspace(listTab).isDisabled());
  await listTab.getByLabel('导入本地视频').setInputFiles(videoFile);
  await listTab.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  await listTab.waitForFunction(() => !document.querySelector('textarea').disabled);
  assert.notEqual(await workspace(listTab).inputValue(), snapshot.text);
  assert.deepEqual(await draftSnapshot(), snapshot);
  await middleTab.close(); await modifierTab.close(); await listTab.close();
  record('项目链接支持中键/Cmd 或 Ctrl/普通点击；刷新保持指定 URL，新标签页独立选片校验');

  const detail = (await api(`${listPath}/${project.id}`)).project;
  const setupDev = await browser.newContext({ baseURL });
  await api('/auth/login', 'POST', { username: 'project-dev', password }, setupDev);
  const otherProject = (await api(`/organizations/${otherOrg.id}/projects`, 'POST', {
    name: title + ' 另组织', description: '', media: detail.media, source: null,
  }, setupDev)).project;
  await setupDev.close();
  const otherPath = `/organizations/${otherOrg.id}/projects/${otherProject.id}/workspace`;
  const fresh = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const direct = await fresh.newPage(); watch(direct);
  await direct.goto(otherPath); await login(direct);
  await workspace(direct).waitFor();
  assert.equal(new URL(direct.url()).pathname, otherPath);
  assert.equal(await direct.getByLabel('当前组织', { exact: true }).inputValue(), String(otherOrg.id));
  await direct.reload(); await workspace(direct).waitFor();
  assert.equal(new URL(direct.url()).pathname, otherPath);
  await fresh.close();
  record('未登录直达非默认组织项目，登录后继续原地址，刷新不退回默认组织');

  // Establish two different project history entries, then guard a pop traversal.
  await page.goBack(); await page.waitForURL('**' + listPath); await page.getByRole('heading', { name: '项目', exact: true }).waitFor();
  const second = (await api(listPath, 'POST', { name: title + ' 第二', description: '', media: detail.media, source: null })).project;
  await page.getByLabel('搜索项目', { exact: true }).fill(second.name);
  const secondLink = page.getByRole('link', { name: second.name, exact: true });
  await secondLink.click(); await modal('打开其他项目').waitFor();
  assert.equal(new URL(page.url()).pathname, listPath);
  await modal('打开其他项目').getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(new URL(page.url()).pathname, listPath);
  await page.getByRole('link', { name: '返回工作区', exact: true }).click();
  await workspace(page).waitFor(); assert.deepEqual(await draftSnapshot(), snapshot);
  await page.getByLabel('当前组织', { exact: true }).selectOption(String(otherOrg.id));
  await modal('切换组织').waitFor();
  await modal('切换组织').getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(new URL(page.url()).pathname, projectPath);
  assert.equal(await page.getByLabel('当前组织', { exact: true }).inputValue(), String(org.id));
  await page.getByRole('link', { name: '项目列表', exact: true }).evaluate(link => { link.target = '_self'; link.click(); });
  await page.waitForURL('**' + listPath);
  await page.getByLabel('搜索项目', { exact: true }).fill(second.name);
  await page.getByRole('link', { name: second.name, exact: true }).click();
  await modal('打开其他项目').getByRole('button', { name: '明确放弃并继续', exact: true }).click();
  const secondPath = `${listPath}/${second.id}/workspace`;
  await page.waitForURL('**' + secondPath); await workspace(page).waitFor();
  await page.goBack(); await page.waitForURL('**' + listPath); await page.getByRole('heading', { name: '项目', exact: true }).waitFor();
  // The earlier A entry is before this list; returning to A replaces retained B.
  await page.goBack();
  await modal('打开其他项目').waitFor();
  assert.equal(new URL(page.url()).pathname, listPath);
  await modal('打开其他项目').getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(new URL(page.url()).pathname, listPath);
  await page.goBack(); await modal('打开其他项目').waitFor();
  await modal('打开其他项目').getByRole('button', { name: '明确放弃并继续', exact: true }).click();
  await page.waitForURL('**' + projectPath); await workspace(page).waitFor();
  await page.goForward(); await page.waitForURL('**' + listPath); await page.getByRole('heading', { name: '项目', exact: true }).waitFor();
  await page.goForward(); await modal('打开其他项目').waitFor();
  await modal('打开其他项目').getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(new URL(page.url()).pathname, listPath);
  await page.goForward(); await modal('打开其他项目').waitFor();
  await modal('打开其他项目').getByRole('button', { name: '明确放弃并继续', exact: true }).click();
  await page.waitForURL('**' + secondPath); await workspace(page).waitFor();
  await page.evaluate(() => history.go(-2));
  await modal('打开其他项目').waitFor();
  assert.equal(new URL(page.url()).pathname, secondPath);
  await modal('打开其他项目').getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(new URL(page.url()).pathname, secondPath);
  record('取消项目/组织链接及受保护回退后，URL、组织与保留的工作区一致');

  const protectedPath = page.url();
  await page.getByRole('link', { name: '项目列表', exact: true }).evaluate(link => { link.target = '_self'; link.click(); });
  await page.getByRole('heading', { name: '项目', exact: true }).waitFor();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await modal('新建项目').waitFor();
  assert.equal(await page.getByLabel('项目名称', { exact: true }).count(), 0);
  await modal('新建项目').getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('link', { name: '返回工作区', exact: true }).click();
  await workspace(page).waitFor(); assert.equal(page.url(), protectedPath);
  // Isolate the native cancelled-navigation probe from history traversal tests.
  const reloadContext = await browser.newContext({ baseURL, storageState: await context.storageState() });
  const reloadPage = await reloadContext.newPage();
  reloadPage.on('pageerror', error => errors.push(String(error)));
  await reloadPage.goto(projectPath);
  await reloadPage.getByLabel('导入本地视频').setInputFiles(videoFile);
  await reloadPage.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  await reloadPage.getByLabel('字幕中文文本').fill('取消刷新保护');
  const beforeReload = await reloadPage.evaluate(() => { window.__beforeReloadSentinel = true; return document.querySelector('video').src; });
  reloadPage.on('dialog', dialog => dialog.dismiss());
  const reloadPrompt = reloadPage.waitForEvent('dialog');
  const reload = reloadPage.reload({ timeout: 3000 }).catch(() => null);
  assert.equal((await reloadPrompt).type(), 'beforeunload'); await reload;
  assert(await reloadPage.evaluate(() => window.__beforeReloadSentinel));
  assert.equal(await reloadPage.getByLabel('字幕中文文本').inputValue(), '取消刷新保护');
  assert.equal(await reloadPage.locator('video').evaluate(video => video.src), beforeReload);
  reloadPage.removeAllListeners('dialog'); reloadPage.on('dialog', dialog => dialog.accept());
  await reloadPage.goto('about:blank'); await reloadContext.close();
  record('创建前可取消旧工作区替换；实际刷新触发 beforeunload，取消刷新保留当前页面');

  // Create archive/permission fixtures using the real server's authorization.
  const dev = await browser.newContext({ baseURL });
  await api('/auth/login', 'POST', { username: 'project-dev', password }, dev);
  const allOrganizations = (await api('/organizations', 'GET', undefined, dev)).organizations;
  const privateOrg = allOrganizations.find(value => !organizations.some(org => org.id === value.id));
  const privateProject = (await api(`/organizations/${privateOrg.id}/projects`, 'POST', {
    name: title + ' 私有', description: '', media: detail.media, source: null,
  }, dev)).project;
  await api(`${listPath}/${project.id}/archive`, 'POST', { revision: detail.revision }, dev);
  const errorsTab = await context.newPage();
  await errorsTab.goto(`/organizations/${privateOrg.id}/projects/${privateProject.id}/workspace`);
  await errorsTab.getByText('无权访问此组织或项目。', { exact: true }).waitFor();
  assert.equal(await errorsTab.getByRole('link', { name: '返回项目列表', exact: true }).getAttribute('href'), `/organizations/${privateOrg.id}/projects`);
  await errorsTab.goto(`${listPath}/999999999/workspace`);
  await errorsTab.getByText('组织或项目不存在，或项目不属于指定组织。', { exact: true }).waitFor();
  await errorsTab.goto(projectPath); await workspace(errorsTab).waitFor();
  await errorsTab.getByText('已归档项目仅可查看和导出。', { exact: true }).waitFor();
  assert(await workspace(errorsTab).isDisabled());
  assert.equal(await errorsTab.getByRole('button', { name: '保存项目', exact: true }).count(), 0);
  await errorsTab.goto('/missing-page'); await errorsTab.getByText('页面不存在。', { exact: true }).waitFor();

  // Fault injection exercises loading failures/retries and stale response isolation.
  const failedPath = `${listPath}/${second.id}`;
  await errorsTab.route('**/api' + failedPath, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unavailable', message: '测试服务不可用' } }) }));
  await errorsTab.goto(secondPath); await errorsTab.getByText('项目加载失败，请重试。', { exact: true }).waitFor();
  assert.equal(new URL(errorsTab.url()).pathname, secondPath);
  await errorsTab.unroute('**/api' + failedPath);
  await errorsTab.getByRole('button', { name: '重试加载', exact: true }).click();
  await workspace(errorsTab).waitFor();
  await errorsTab.getByRole('link', { name: '项目列表', exact: true }).evaluate(link => { link.target = '_self'; link.click(); });
  await errorsTab.getByRole('heading', { name: '项目', exact: true }).waitFor();
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let received;
  const requested = new Promise(resolve => { received = resolve; });
  await errorsTab.route('**/api' + failedPath, async route => { received(); await held; await route.continue(); });
  await errorsTab.getByRole('link', { name: second.name, exact: true }).click();
  await requested;
  await errorsTab.getByRole('link', { name: '返回项目列表', exact: true }).click();
  await errorsTab.getByRole('heading', { name: '项目', exact: true }).waitFor();
  const completed = errorsTab.waitForResponse(response => new URL(response.url()).pathname === '/api' + failedPath);
  release(); await completed;
  assert.equal(new URL(errorsTab.url()).pathname, listPath);
  assert.equal(await errorsTab.getByRole('heading', { name: '项目', exact: true }).count(), 1);
  await errorsTab.close(); await dev.close();
  record('真实 403/404、归档只读、未知路径及 503 重试明确；延迟响应不能覆盖后续导航');

  const localContext = await browser.newContext({ baseURL });
  const local = await localContext.newPage(); watch(local);
  await local.goto('/workspace/local'); await login(local, 'project-empty');
  await local.locator('video').waitFor();
  assert.equal(new URL(local.url()).pathname, '/workspace/local');
  assert.equal(await local.getByRole('link', { name: '项目列表', exact: true }).getAttribute('href'), '/projects');
  assert.equal(await local.getByRole('link', { name: '项目列表', exact: true }).getAttribute('target'), '_blank');
  await local.getByLabel('导入本地视频').setInputFiles(videoFile);
  await local.getByLabel('字幕中文文本').fill('本地会话保护草稿');
  await local.getByLabel('入点', { exact: true }).fill('0:00:00.40');
  await local.evaluate(() => { window.__localSessionVideo = document.querySelector('video'); });
  await api('/auth/logout', 'POST', {}, localContext);
  await local.evaluate(() => window.dispatchEvent(new Event('focus')));
  await local.getByRole('button', { name: '重新登录', exact: true }).click();
  await login(local, 'project-empty');
  await modal('重新登录', local).waitFor({ state: 'hidden' });
  assert.equal(await local.getByLabel('字幕中文文本').inputValue(), '本地会话保护草稿');
  assert.equal(await local.getByLabel('入点', { exact: true }).inputValue(), '0:00:00.40');
  assert(await local.locator('video').evaluate(video => video === window.__localSessionVideo));
  await api('/auth/login', 'POST', { username: 'project-organizer', password }, localContext);
  await local.evaluate(() => window.dispatchEvent(new Event('focus')));
  await modal('切换到账号 project-organizer', local).waitFor();
  await modal('切换到账号 project-organizer', local).getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(new URL(local.url()).pathname, '/workspace/local');
  assert.equal(await local.getByLabel('字幕中文文本').inputValue(), '本地会话保护草稿');
  await login(local, 'project-empty'); await modal('重新登录', local).waitFor({ state: 'hidden' });
  assert(await local.locator('video').evaluate(video => video === window.__localSessionVideo));
  await local.getByRole('button', { name: 'project-empty', exact: true }).click();
  await local.getByRole('button', { name: '退出账号', exact: true }).click();
  await modal('退出账号', local).getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(new URL(local.url()).pathname, '/workspace/local');
  assert.equal(await local.getByLabel('字幕中文文本').inputValue(), '本地会话保护草稿');
  await localContext.close();
  record('无组织本地入口明确；同账号恢复、取消跨账号切换/退出均保留本地草稿与 video');

  // These requests prove the development/preview fallback does not swallow API/Admin.
  for (const path of [projectPath, listPath, '/workspace/local']) {
    const response = await context.request.get(path);
    assert.equal(response.status(), 200); assert((await response.text()).includes('<div id="root">'));
  }
  assert.equal((await context.request.get('/api/not-a-route')).status(), 404);
  const admin = await context.request.get('/admin/login/');
  assert.equal(admin.status(), 200); assert((await admin.text()).includes('csrfmiddlewaretoken'));
  assert(!(await admin.text()).includes('<div id="root">'));
  assert.equal((await context.request.get('/static/admin/css/base.css')).status(), 200);
  record('深路径入口可加载；/api 错误和 /admin 及静态资源未被前端入口吞掉');
  assert.deepEqual(errors, []);
  assert(uploads.every(type => type?.startsWith('application/json')));
  await page.screenshot({ path: join(artifacts, 'navigation.png'), fullPage: true });
  console.log(JSON.stringify({ browser: browser.version(), baseURL, checks, errors, artifacts }, null, 2));
} catch (error) {
  console.error('URL', page.url(), 'UI', await page.locator('body').innerText());
  await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true });
  throw error;
} finally {
  for (const candidate of browser.contexts()) await candidate.close();
  await browser.close();
}
