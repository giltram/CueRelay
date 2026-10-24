import { sameTab } from './link-navigation.mjs';
// Real project browser flows. Prepare backend/browser_tests/seed_projects.py first.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const password = process.env.BROWSER_TEST_PASSWORD;
if (!password) throw new Error('Set BROWSER_TEST_PASSWORD');
const baseURL = process.env.PROJECTS_URL || 'http://127.0.0.1:5177';
const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-projects-'));
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(artifacts, 'video.mp4')]);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=10:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(artifacts, 'wrong.mp4')]);
writeFileSync(join(artifacts, 'invalid.ass'), 'not an ass');
const fixture = resolve('backend/ass_format/fixtures/basic.ass');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ baseURL, acceptDownloads: true, viewport: { width: 1440, height: 950 } });
context.setDefaultTimeout(15000);
const page = await context.newPage();
const errors = [];
const uploads = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => {
  if (request.method() !== 'GET') uploads.push({ url: new URL(request.url()).pathname, contentType: request.headers()['content-type'] });
});
const passed = [];
const check = message => { passed.push(message); console.log('PASS', message); };
const shown = locator => locator.waitFor({ state: 'visible' });
const hidden = locator => locator.waitFor({ state: 'hidden' });
const modal = title => page.getByRole('dialog', { name: title, exact: true });
async function login(target = page, name = 'project-organizer') {
  await target.goto('/');
  await target.getByLabel('用户名', { exact: true }).fill(name);
  await target.getByLabel('密码', { exact: true }).fill(password);
  await target.getByRole('button', { name: '登录', exact: true }).click();
  await target.getByRole('heading', { name: '项目', exact: true }).waitFor();
}
async function api(path, method = 'GET', body, requestContext = context) {
  await requestContext.request.get('/api/auth/session');
  const csrf = (await requestContext.cookies()).find(cookie => cookie.name === 'csrftoken').value;
  const response = await requestContext.request.fetch('/api' + path, { method, data: body, headers: { 'X-CSRFToken': csrf } });
  assert(response.ok(), `${method} ${path}: ${await response.text()}`);
  return response.json();
}
const row = name => page.locator('.project-table tbody tr').filter({ has: page.getByRole('link', { name, exact: true }) });
async function toList() { await page.getByRole('link', { name: '项目列表', exact: true }).evaluate(link => { link.target = '_self'; link.click(); }); await shown(page.getByRole('heading', { name: '项目', exact: true })); }
async function manage(name, action) {
  await row(name).getByRole('button', { name: action, exact: true }).click();
}
try {
  await login();
  await shown(page.getByRole('button', { name: '新建项目', exact: true }));
  assert.equal(await page.locator('video').count(), 0);
  const organizations = (await api('/organizations')).organizations;
  const org = organizations.find(value => value.role === 'organizer');
  const base = `/organizations/${org.id}/projects`;
  const title = `浏览器项目 ${Date.now()}`;
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  await page.getByLabel('项目名称', { exact: true }).fill(title);
  await page.getByLabel('项目说明', { exact: true }).fill('项目面板集成测试');
  await page.getByLabel('基准视频', { exact: true }).setInputFiles(join(artifacts, 'video.mp4'));
  await shown(page.getByText(/完整校验通过/));
  await page.getByLabel('初始字幕', { exact: true }).selectOption('import');
  await page.getByLabel('ASS 文件', { exact: true }).setInputFiles(join(artifacts, 'invalid.ass'));
  await shown(modal('新建项目').getByRole('alert'));
  assert.equal((await api(base)).projects.some(value => value.name === title), false);
  await page.getByLabel('ASS 文件', { exact: true }).setInputFiles(fixture);
  await shown(page.getByText(/字幕预检通过/));
  await modal('新建项目').getByRole('button', { name: '创建并打开', exact: true }).click();
  await hidden(modal('新建项目'));
  await shown(page.getByRole('button', { name: '选择第 1 行', exact: true }));
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 1);
  await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  await page.getByLabel('字幕中文文本').fill('首次保存的项目字幕');
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await shown(page.getByText('项目已保存。尚未应用的时间输入不包含在本次保存中。', { exact: true }));
  let project = (await api(base)).projects.find(value => value.name === title);
  const detail = (await api(`${base}/${project.id}`)).project;
  assert.equal(detail.document.cues[0].text, '首次保存的项目字幕');
  assert.equal(detail.media.sha256.length, 64);
  check('视频分块校验、非法 ASS 不留下项目、合法初始化与字幕快照保存');

  await page.getByLabel('字幕中文文本').fill('尚未保存的本地修改');
  await page.getByLabel('入点', { exact: true }).fill('0:00:00.30');
  const before = await page.evaluate(() => {
    window.__projectVideo = document.querySelector('video');
    return { src: window.__projectVideo.src, start: document.querySelector('input[aria-label="入点"]').value, text: document.querySelector('textarea').value };
  });
  await toList();
  await sameTab(row(title).getByRole('link', { name: title, exact: true }));
  assert.deepEqual(await page.evaluate(() => ({ src: document.querySelector('video').src, start: document.querySelector('input[aria-label="入点"]').value, text: document.querySelector('textarea').value })), before);
  assert(await page.evaluate(() => document.querySelector('video') === window.__projectVideo));
  await toList();
  await page.getByLabel('搜索项目', { exact: true }).fill('无此项目名');
  await shown(page.getByText('没有找到匹配的项目。', { exact: true }));
  await page.getByRole('button', { name: '清除搜索', exact: true }).click();
  await shown(row(title));
  await sameTab(row(title).getByRole('link', { name: '项目设置', exact: true }));
  await shown(page.getByRole('heading', { name: '项目设置', exact: true }));
  await page.getByLabel('项目名称', { exact: true }).fill(title + ' 本地名称');
  project = (await api(`${base}/${project.id}`)).project;
  await api(`${base}/${project.id}`, 'PATCH', { name: title + ' 远端名称', description: '', revision: project.revision });
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await shown(page.getByRole('alert'));
  assert.equal(await page.getByLabel('项目名称', { exact: true }).inputValue(), title + ' 本地名称');
  await page.getByRole('button', { name: '刷新项目版本', exact: true }).click();
  await shown(page.getByText(/当前服务器版本/));
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await shown(page.getByText('项目设置已保存。', { exact: true }));
  await page.getByRole('link', { name: '返回项目列表', exact: true }).click();
  const renamed = title + ' 本地名称';
  await shown(row(renamed));
  await page.screenshot({ path: join(artifacts, 'projects-active.png'), fullPage: true });
  check('浏览列表保留同一个 video 与时间草稿；搜索及管理冲突保留输入后显式刷新');

  await page.getByLabel('搜索项目', { exact: true }).fill(renamed);
  await sameTab(row(renamed).getByRole('link', { name: renamed, exact: true }));
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await shown(page.getByRole('alert').filter({ hasText: '项目已被其他操作更新' }));
  assert.equal(await page.getByLabel('字幕中文文本').inputValue(), '尚未保存的本地修改');
  await page.getByRole('button', { name: '重新加载项目', exact: true }).click();
  await shown(modal('重新加载项目'));
  const download = page.waitForEvent('download');
  await modal('重新加载项目').getByRole('button', { name: '导出 ASS', exact: true }).click();
  assert(readFileSync(await (await download).path(), 'utf8').includes('尚未保存的本地修改'));
  await modal('重新加载项目').getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '重新加载项目', exact: true }).click();
  await modal('重新加载项目').getByRole('button', { name: '明确放弃并继续', exact: true }).click();
  await hidden(modal('重新加载项目'));
  await page.getByLabel('导入本地视频', { exact: true }).setInputFiles(join(artifacts, 'wrong.mp4'));
  await shown(page.getByRole('alert').filter({ hasText: /片源/ }));
  assert(await page.getByLabel('字幕中文文本').isDisabled());
  await page.getByLabel('导入本地视频', { exact: true }).setInputFiles(join(artifacts, 'video.mp4'));
  await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  await page.getByLabel('字幕中文文本').fill('重新加载后保存');
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await shown(page.getByText('项目已保存。尚未应用的时间输入不包含在本次保存中。', { exact: true }));
  check('旧快照不能覆盖新版本、冲突时可导出取消；重载需明确放弃；错误视频不可编辑');

  await toList();
  await manage(renamed, '归档项目');
  await modal('归档项目').getByRole('button', { name: '确认归档', exact: true }).click();
  await hidden(modal('归档项目'));
  await page.getByRole('tab', { name: '过去项目', exact: true }).click();
  await shown(row(renamed));
  await sameTab(row(renamed).getByRole('link', { name: renamed, exact: true }));
  await shown(page.getByText('已归档项目仅可查看和导出。', { exact: true }));
  assert(await page.getByLabel('字幕中文文本').isDisabled());
  assert.equal(await page.getByRole('button', { name: '保存项目', exact: true }).count(), 0);
  await toList(); await page.getByRole('tab', { name: '过去项目', exact: true }).click();
  await manage(renamed, '恢复项目');
  await modal('恢复项目').getByRole('button', { name: '确认恢复', exact: true }).click();
  await hidden(modal('恢复项目'));
  await page.getByRole('tab', { name: '进行中', exact: true }).click(); await shown(row(renamed));
  check('进行中/过去项目、归档只读和恢复');

  const memberContext = await browser.newContext({ baseURL });
  const memberPage = await memberContext.newPage();
  await login(memberPage, 'project-member');
  const orgOptions = await memberPage.locator('#organization option').allTextContents();
  const memberOrg = organizations.find(value => value.id === org.id);
  await memberPage.getByLabel('当前组织', { exact: true }).selectOption(String(memberOrg.id));
  await memberPage.getByRole('link', { name: renamed, exact: true }).waitFor();
  assert.equal(await memberPage.getByRole('button', { name: '新建项目', exact: true }).count(), 0);
  assert.equal(await memberPage.getByRole('link', { name: '项目设置', exact: true }).count(), 0);
  assert.equal(await memberPage.getByRole('button', { name: '归档项目', exact: true }).count(), 0);
  await sameTab(memberPage.getByRole('row').filter({ has: memberPage.getByRole('link', { name: renamed, exact: true }) }).getByRole('link', { name: renamed, exact: true }));
  await memberPage.getByLabel('导入本地视频', { exact: true }).setInputFiles(join(artifacts, 'video.mp4'));
  await memberPage.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  await memberPage.getByLabel('字幕中文文本').fill('普通成员的字幕修改');
  await memberPage.getByRole('button', { name: '保存项目', exact: true }).click();
  await memberPage.getByText('项目已保存。尚未应用的时间输入不包含在本次保存中。', { exact: true }).waitFor();
  await memberContext.close();
  check('member 无项目管理入口，校验片源后仍能保存字幕');

  // Session logout must retain even a hidden project workspace and all draft input.
  await page.getByLabel('搜索项目', { exact: true }).fill(renamed);
  await sameTab(row(renamed).getByRole('link', { name: renamed, exact: true }));
  await api('/auth/logout', 'POST', {});
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await shown(modal('重新登录'));
  await modal('重新登录').getByLabel('用户名', { exact: true }).fill('project-organizer');
  await modal('重新登录').getByLabel('密码', { exact: true }).fill(password);
  await modal('重新登录').getByRole('button', { name: '登录', exact: true }).click();
  await hidden(modal('重新登录'));
  await shown(page.getByRole('button', { name: '选择第 1 行', exact: true }));
  check('项目工作区会话失效后同账号登录保持挂载');
  await toList();
  const second = (await api(base, 'POST', { name: title + ' 第二项目', description: '', media: detail.media, source: null })).project;
  // Refresh the panel list without touching the retained workspace.
  await page.getByLabel('搜索项目', { exact: true }).fill(title);
  await sameTab(row(second.name).getByRole('link', { name: second.name, exact: true }));
  await shown(modal('打开其他项目'));
  await modal('打开其他项目').getByRole('button', { name: '取消', exact: true }).click();
  await page.getByLabel('搜索项目', { exact: true }).fill(renamed);
  await sameTab(row(renamed).getByRole('link', { name: renamed, exact: true }));
  assert.equal(await page.getByLabel('字幕中文文本').inputValue(), '重新加载后保存');
  await toList();
  // Reloading the whole browser reads only explicitly saved server state.
  page.on('dialog', dialog => dialog.accept());
  await page.reload();
  await sameTab(row(renamed).getByRole('link', { name: renamed, exact: true }));
  await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  assert.equal(await page.getByLabel('字幕中文文本').inputValue(), '普通成员的字幕修改');
  assert(await page.getByLabel('字幕中文文本').isDisabled());
  await toList();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(artifacts, 'projects-mobile.png'), fullPage: true });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  check('切换项目取消保留稿件、整页刷新后加载已保存快照、窄屏列表可操作');
  await page.setViewportSize({ width: 1440, height: 950 });
  const prefix = `分页 ${Date.now()}`;
  for (let i = 0; i < 26; i++) await api(base, 'POST', { name: `${prefix} ${i}`, description: '', media: detail.media, source: null });
  await page.getByLabel('搜索项目', { exact: true }).fill(prefix);
  await shown(page.getByText('共 26 个项目 · 第 1 页', { exact: true }));
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await shown(page.getByText('共 26 个项目 · 第 2 页', { exact: true }));
  await page.getByRole('button', { name: '归档项目', exact: true }).click();
  await modal('归档项目').getByRole('button', { name: '确认归档', exact: true }).click();
  await hidden(modal('归档项目'));
  await shown(page.getByText('共 25 个项目 · 第 1 页', { exact: true }));
  check('分页浏览及归档末页最后一项后自动返回有效页码');


  assert.deepEqual(errors, []);
  assert(uploads.every(value => value.contentType?.startsWith('application/json')));
  console.log(JSON.stringify({ browser: browser.version(), passed, errors, artifacts, uploads: uploads.length }, null, 2));
} catch (error) {
  console.log('UI AT FAILURE', await page.locator('body').innerText());
  console.log('PAGE ERRORS', errors);
  await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true });
  throw error;
} finally { await browser.close(); }
