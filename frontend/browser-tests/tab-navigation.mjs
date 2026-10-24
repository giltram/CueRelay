// Default user-facing tab policy. Uses real APIs and the disposable project fixtures.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const password = process.env.BROWSER_TEST_PASSWORD;
if (!password) throw new Error('Set BROWSER_TEST_PASSWORD and seed disposable project fixtures');
const baseURL = process.env.PROJECTS_URL || 'http://127.0.0.1:5196';
const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-tab-navigation-'));
const videoFile = join(artifacts, 'tabs.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=20',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoFile]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
context.setDefaultTimeout(15000);
const errors = [], checks = [];
context.on('page', page => {
  page.on('pageerror', error => errors.push(String(error)));
  page.on('dialog', dialog => { if (dialog.type() === 'beforeunload') void dialog.accept(); else void dialog.dismiss(); });
});
const page = await context.newPage();
const record = label => { checks.push(label); console.log('PASS', label); };
async function api(path, method = 'GET', data) {
  await context.request.get('/api/auth/session');
  const token = (await context.cookies()).find(cookie => cookie.name === 'csrftoken').value;
  const response = await context.request.fetch('/api' + path, { method, data, headers: { 'X-CSRFToken': token } });
  assert(response.ok(), `${method} ${path}: ${await response.text()}`);
  return response.json();
}
async function open(link) {
  assert.equal(await link.getAttribute('target'), '_blank');
  const popup = context.waitForEvent('page'); await link.click();
  const tab = await popup; await tab.waitForLoadState('domcontentloaded');
  assert.equal(await tab.evaluate(() => window.opener), null);
  return tab;
}
try {
  await page.goto('/');
  await page.getByLabel('用户名', { exact: true }).fill('project-organizer');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('heading', { name: '项目', exact: true }).waitFor();
  const orgs = (await api('/organizations')).organizations;
  const org = orgs.find(value => value.role === 'organizer');
  const other = orgs.find(value => value.role === 'member');
  const initialTabs = context.pages().length;
  await page.getByLabel('当前组织', { exact: true }).selectOption(String(other.id));
  assert.equal(context.pages().length, initialTabs);
  const otherListPath = `/organizations/${other.id}/projects`;
  await page.waitForURL('**' + otherListPath);
  const personal = await open(page.getByRole('link', { name: '设置', exact: true }));
  await personal.getByLabel('旧密码', { exact: true }).waitFor();
  assert.equal(new URL(personal.url()).pathname, `/organizations/${other.id}/settings/personal`);
  assert.equal(await personal.getByLabel('当前组织', { exact: true }).count(), 0);
  await personal.getByLabel('提交并下一条绑定').fill('Shift+KeyT');
  const members = await open(personal.getByRole('link', { name: '组织设置', exact: true }));
  await members.getByRole('cell', { name: 'project-organizer', exact: true }).waitFor();
  assert.equal(new URL(members.url()).pathname, `/organizations/${other.id}/settings`);
  assert.equal(await members.getByLabel('添加成员', { exact: true }).count(), 0);
  assert.equal(await personal.getByLabel('提交并下一条绑定').inputValue(), 'Shift+KeyT');
  const personalAgain = await open(members.getByRole('link', { name: '个人设置', exact: true }));
  await personalAgain.getByLabel('旧密码', { exact: true }).waitFor();
  assert.equal(new URL(personalAgain.url()).pathname, `/organizations/${other.id}/settings/personal`);
  const local = await open(page.getByRole('link', { name: '本地工作区', exact: true }));
  await local.locator('video').waitFor();
  assert.equal(new URL(local.url()).pathname, `/organizations/${other.id}/workspace/local`);
  assert.equal(await local.getByLabel('当前组织', { exact: true }).count(), 0);
  const localList = await open(local.getByRole('link', { name: '项目列表', exact: true }));
  await localList.getByRole('heading', { name: '项目', exact: true }).waitFor();
  assert.equal(new URL(localList.url()).pathname, otherListPath);
  for (const tab of [personal, members, personalAgain, local, localList]) await tab.close();
  record('组织选择留在列表原 tab；设置/分类/本地工作区/项目列表普通点击均新开，保留非默认组织且没有组织切换控件');

  await page.getByLabel('当前组织', { exact: true }).selectOption(String(org.id));
  const listPath = `/organizations/${org.id}/projects`;
  await page.waitForURL('**' + listPath);
  const creation = page;
  const beforeCreateTabs = context.pages().length;
  await creation.getByRole('button', { name: '新建项目', exact: true }).click();
  await creation.getByRole('dialog', { name: '新建项目', exact: true }).waitFor();
  assert.equal(context.pages().length, beforeCreateTabs);
  assert.equal(new URL(creation.url()).pathname, listPath);
  const title = `新标签页 ${Date.now()}`;
  await creation.getByLabel('项目名称', { exact: true }).fill(title);
  await creation.getByLabel('基准视频', { exact: true }).setInputFiles(videoFile);
  await creation.getByText(/完整校验通过/).waitFor();
  await creation.getByRole('button', { name: '创建并打开', exact: true }).click();
  await creation.waitForURL(/\/projects\/\d+\/workspace$/);
  const projectPath = new URL(creation.url()).pathname;
  const projectId = Number(projectPath.split('/').at(-2));
  await creation.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  assert.equal(await creation.getByLabel('当前组织', { exact: true }).count(), 0);
  assert.equal(context.pages().length, beforeCreateTabs);
  assert.equal(new URL(page.url()).pathname, projectPath);
  await creation.goBack(); await creation.getByRole('heading', { name: '项目', exact: true }).waitFor();
  assert.equal(new URL(creation.url()).pathname, listPath);
  await creation.goForward(); await creation.locator('video').waitFor();
  assert(await creation.locator('video').evaluate(video => video.src.startsWith('blob:') && video.readyState >= 2));
  record('新建在当前列表打开单页弹窗，不新开 tab；创建后同页进入工作区，无二次选片，前进/回退保留 File');

  // Add an actual cue to enable editing even for the server's empty document.
  await creation.getByLabel('出点', { exact: true }).fill('0:00:02.00');
  await creation.locator('.audio-stage').focus(); await creation.keyboard.press('KeyG');
  await creation.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  await creation.getByLabel('字幕中文文本').fill('原标签页字幕保留');
  await creation.getByLabel('入点', { exact: true }).fill('0:00:00.40');
  await creation.locator('video').evaluate(async video => { video.currentTime = 1; video.muted = true; await video.play(); });
  const snapshot = await creation.evaluate(() => {
    window.__tabVideo = document.querySelector('video');
    return { src: window.__tabVideo.src, time: window.__tabVideo.currentTime, text: document.querySelector('textarea').value,
      start: document.querySelector('input[aria-label="入点"]').value };
  });
  const list = await open(creation.getByRole('link', { name: '项目列表', exact: true }));
  await list.getByRole('heading', { name: '项目', exact: true }).waitFor();
  const settings = await open(creation.getByRole('link', { name: '设置', exact: true }));
  await settings.getByLabel('旧密码', { exact: true }).waitFor();
  const current = await creation.evaluate(() => ({ same: window.__tabVideo === document.querySelector('video'),
    src: document.querySelector('video').src, time: document.querySelector('video').currentTime,
    playing: !document.querySelector('video').paused, text: document.querySelector('textarea').value,
    start: document.querySelector('input[aria-label="入点"]').value }));
  assert(current.same && current.playing && current.time > snapshot.time);
  assert.equal(current.src, snapshot.src); assert.equal(current.text, snapshot.text); assert.equal(current.start, snapshot.start);
  const byName = await open(list.getByRole('link', { name: title, exact: true }));
  await byName.getByLabel('字幕中文文本').waitFor();
  assert(await byName.getByLabel('字幕中文文本').isDisabled());
  assert.equal(await byName.locator('video').getAttribute('src'), null);
  const byOpen = await open(list.getByRole('row').filter({ has: list.getByRole('link', { name: title, exact: true }) }).getByRole('link', { name: '打开', exact: true }));
  await byOpen.getByLabel('字幕中文文本').waitFor();
  assert.equal(new URL(byOpen.url()).pathname, projectPath);
  await byOpen.reload(); await byOpen.getByLabel('字幕中文文本').waitFor();
  assert.equal(await byOpen.locator('video').getAttribute('src'), null);
  record('项目名称/打开/工作区列表/设置普通点击新开；原视频继续播放，字幕和时间草稿保留；普通打开及刷新独立选片');

  await creation.locator('video').evaluate(video => video.pause());
  const beforeHome = context.pages().length;
  await creation.getByRole('link', { name: 'CueRelay', exact: true }).click();
  await creation.waitForURL(new URL('/', baseURL).href);
  assert.equal(context.pages().length, beforeHome);
  await creation.getByLabel('当前组织', { exact: true }).selectOption(String(other.id));
  const guard = creation.getByRole('dialog', { name: '切换组织', exact: true });
  await guard.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(new URL(creation.url()).pathname, '/');
  assert.equal(await creation.getByLabel('当前组织', { exact: true }).inputValue(), String(org.id));
  await creation.goBack(); await creation.locator('video').waitFor();
  assert.equal(await creation.getByLabel('字幕中文文本').inputValue(), snapshot.text);
  assert(await creation.locator('video').evaluate(video => video === window.__tabVideo));
  record('CueRelay 继续原 tab 返回首页；组织只能在列表切换，取消保护后 URL/组织/原工作区一致');

  const errorPage = await context.newPage();
  await errorPage.goto(`${listPath}/999999999/workspace`);
  await errorPage.getByText('组织或项目不存在，或项目不属于指定组织。', { exact: true }).waitFor();
  const count = context.pages().length;
  const returnLink = errorPage.getByRole('link', { name: '返回项目列表', exact: true });
  assert.equal(await returnLink.getAttribute('target'), '_self'); await returnLink.click();
  await errorPage.getByRole('heading', { name: '项目', exact: true }).waitFor();
  assert.equal(context.pages().length, count);
  await errorPage.goto('/organizations/999999999/projects/1/workspace');
  await errorPage.getByRole('link', { name: '选择可访问的组织', exact: true }).click();
  await errorPage.getByRole('heading', { name: '项目', exact: true }).waitFor();
  assert.equal(context.pages().length, count);

  const detail = (await api(`${listPath}/${projectId}`)).project;
  await api(`${listPath}/${projectId}/archive`, 'POST', { revision: detail.revision });
  await list.getByRole('tab', { name: '过去项目', exact: true }).click();
  const readOnly = await open(list.getByRole('row').filter({ has: list.getByRole('link', { name: title, exact: true }) }).getByRole('link', { name: '只读查看', exact: true }));
  await readOnly.getByText('已归档项目仅可查看和导出。', { exact: true }).waitFor();
  assert(await readOnly.getByLabel('字幕中文文本').isDisabled());
  record('错误页两个返回入口留在原 tab；归档只读查看默认新开并继续只读限制');
  await list.screenshot({ path: join(artifacts, 'list.png'), fullPage: true });
  await creation.screenshot({ path: join(artifacts, 'workspace.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: browser.version(), checks, errors, artifacts }, null, 2));
} catch (error) {
  console.error(error);
  for (const [index, tab] of context.pages().entries()) {
    console.error('TAB', index, tab.url());
    await tab.screenshot({ path: join(artifacts, `failure-${index}.png`), fullPage: true }).catch(() => {});
  }
  throw error;
} finally { await context.close(); await browser.close(); }
