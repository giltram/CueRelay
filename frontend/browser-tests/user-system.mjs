import { sameTab } from './link-navigation.mjs';
// Run against the disposable fixture database; see docs/user-system.md.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const baseURL = process.env.USER_SYSTEM_URL || 'http://127.0.0.1:5177';
const password = process.env.BROWSER_TEST_PASSWORD;
if (!password) throw new Error('BROWSER_TEST_PASSWORD is required');
const dir = mkdtempSync(join(tmpdir(), 'cuerelay-users-browser-'));
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'local.mp4')]);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ baseURL, viewport: { width: 1360, height: 900 }, acceptDownloads: true });
context.setDefaultTimeout(15000);
context.setDefaultNavigationTimeout(20000);
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const checks = [];
const record = label => { checks.push(label); console.log('PASS', label); };
const wait = async condition => { await page.waitForFunction(condition); };
const visible = async locator => { await locator.waitFor({ state: 'visible' }); };
const hidden = async locator => { await locator.waitFor({ state: 'hidden' }); };
const dialog = title => page.getByRole('dialog', { name: title, exact: true });
const login = async (username = 'browser-alice', pwd = password, target = page) => {
  await target.getByLabel('用户名', { exact: true }).fill(username);
  await target.getByLabel('密码', { exact: true }).fill(pwd);
  await target.getByRole('button', { name: '登录', exact: true }).click();
};
async function request(path, method = 'GET', data, target = context) {
  await target.request.get('/api/auth/session');
  const token = (await target.cookies()).find(cookie => cookie.name === 'csrftoken').value;
  const response = await target.request.fetch('/api' + path, { method, data, headers: { 'X-CSRFToken': token } });
  assert(response.ok(), `${method} ${path}: ${await response.text()}`);
  return response.json();
}
let settingsOrigin;
let personalSettingsURL;
async function openSettings() {
  settingsOrigin = page.url();
  await sameTab(page.getByRole('link', { name: '设置', exact: true }));
  await visible(page.getByRole('heading', { name: '个人设置', exact: true }));
  personalSettingsURL = page.url();
}
async function openMembers() {
  await openSettings();
  await sameTab(page.getByRole('link', { name: '组织设置', exact: true }));
  await visible(page.getByRole('heading', { name: '组织设置', exact: true }));
  await visible(page.getByRole('cell', { name: 'browser-alice', exact: true }));
}
async function returnFromSettings(section = 'personal') {
  if (section === 'organization') {
    await page.goBack(); await page.waitForURL(personalSettingsURL);
    await visible(page.getByRole('heading', { name: '个人设置', exact: true }));
  }
  await page.goBack();
  await page.waitForURL(settingsOrigin);
  await hidden(page.locator('.settings-page'));
}
async function preserveSnapshot() {
  return page.evaluate(() => ({
    src: document.querySelector('video').src,
    start: document.querySelector('input[aria-label="入点"]')?.value,
    end: document.querySelector('input[aria-label="出点"]')?.value,
    text: document.querySelector('textarea').value,
    selected: document.querySelector('tr.selected')?.textContent,
  }));
}
try {
  await page.goto('/');
  await visible(page.getByRole('button', { name: '登录', exact: true }));
  assert.equal(await page.locator('video').count(), 0);
  await login('browser-alice', 'wrong');
  await visible(page.getByText('用户名或密码不正确。', { exact: true }));
  await login();
  await sameTab(page.getByRole('link', { name: '本地工作区', exact: true }));
  await visible(page.locator('video'));
  assert.equal(await page.getByLabel('当前组织', { exact: true }).count(), 0);
  record('会话初始化、登录失败、登录后组织上下文');

  await openMembers();
  await visible(page.getByLabel('browser-alice角色'));
  await page.getByLabel('browser-alice角色').selectOption('member');
  await visible(page.getByText('组织必须至少保留一名活动 organizer。', { exact: true }));
  for (const width of [1360, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [label, button] of [['组织名称', '保存名称'], ['添加成员', '添加']]) {
      const inputBounds = await page.getByLabel(label, { exact: true }).boundingBox();
      const buttonBounds = await page.getByRole('button', { name: button, exact: true }).boundingBox();
      assert(Math.abs(inputBounds.y - buttonBounds.y) <= 1);
      assert.equal(inputBounds.height, buttonBounds.height);
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(dir, `members-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1360, height: 900 });
  assert.equal(await page.getByLabel('添加成员', { exact: true }).getAttribute('placeholder'), '请输入用户名');
  await page.getByLabel('添加成员', { exact: true }).fill('browser-empty');
  await page.getByRole('button', { name: '添加', exact: true }).click();
  await visible(page.getByLabel('browser-empty角色'));
  await page.getByLabel('browser-empty角色').selectOption('organizer');
  await hidden(page.getByLabel('browser-empty角色'));
  assert.equal(await page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'browser-empty', exact: true }) }).getByRole('button', { name: '移除' }).count(), 0);
  const organizationId = new URL(page.url()).pathname.split('/')[2];
  const peer = (await request(`/organizations/${organizationId}/members`)).members.find(member => member.username === 'browser-empty');
  const devContext = await browser.newContext({ baseURL });
  try {
    await request('/auth/login', 'POST', { username: 'browser-dev', password }, devContext);
    await request(`/organizations/${organizationId}/members/${peer.id}`, 'PATCH', { role: 'member' }, devContext);
  } finally { await devContext.close(); }
  await returnFromSettings('organization');
  await openMembers();
  await visible(page.getByLabel('browser-empty角色'));
  await page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'browser-empty', exact: true }) }).getByRole('button', { name: '移除' }).click();
  await visible(dialog('移除成员'));
  await dialog('移除成员').getByRole('button', { name: '取消', exact: true }).click();
  await visible(page.getByLabel('browser-empty角色'));
  await page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'browser-empty', exact: true }) }).getByRole('button', { name: '移除' }).click();
  await dialog('移除成员').getByRole('button', { name: '确认移除', exact: true }).click();
  await hidden(page.getByLabel('browser-empty角色'));
  await returnFromSettings('organization');
  record('成员表单桌面/窄屏对齐、添加、organizer 同级保护、移除确认/取消、最后 organizer 保护');

  await openSettings();
  assert.equal(await page.getByLabel('显示名', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '保存资料', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '切换账号', exact: true }).count(), 0);
  await page.screenshot({ path: join(dir, 'personal-settings.png'), fullPage: true });
  let passwordRequests = 0;
  page.on('request', request => { if (request.url().endsWith('/api/auth/password')) passwordRequests++; });
  await page.getByLabel('旧密码', { exact: true }).fill('wrong');
  await page.getByLabel('新密码', { exact: true }).fill(password + '-new');
  await page.getByLabel('确认新密码', { exact: true }).fill(password + '-different');
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await visible(page.getByText('两次输入的新密码不一致。', { exact: true }));
  assert.equal(passwordRequests, 0);
  assert.equal(await page.getByLabel('新密码', { exact: true }).inputValue(), password + '-new');
  await page.getByLabel('确认新密码', { exact: true }).fill(password + '-new');
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await visible(page.getByText('旧密码不正确。', { exact: true }));
  await page.getByLabel('旧密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await visible(page.getByText('已保存', { exact: true }));
  for (const label of ['旧密码', '新密码', '确认新密码']) assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), '');
  await page.getByLabel('旧密码', { exact: true }).fill(password + '-new');
  await page.getByLabel('新密码', { exact: true }).fill(password);
  await page.getByLabel('确认新密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await visible(page.getByText('已保存', { exact: true }));
  await page.getByLabel('提交并下一条绑定').fill('Shift+KeyT');
  await page.getByRole('button', { name: '保存快捷键', exact: true }).click();
  await visible(page.getByText('已保存', { exact: true }));
  await returnFromSettings();
  await openSettings(); await page.reload(); await visible(page.getByRole('heading', { name: '个人设置', exact: true }));
  assert.equal(await page.getByLabel('提交并下一条绑定').inputValue(), 'Shift+KeyT');
  await sameTab(page.getByRole('link', { name: '项目列表', exact: true }));
  const orgs = await request('/organizations');
  const orgB = orgs.organizations.find(org => org.role === 'member');
  await page.getByLabel('当前组织', { exact: true }).selectOption(String(orgB.id));
  await openMembers();
  await visible(page.getByRole('heading', { name: '组织设置', exact: true }));
  assert.equal(await page.getByLabel('添加成员', { exact: true }).count(), 0);
  assert.equal(await page.getByLabel('组织名称').count(), 0);
  await returnFromSettings('organization'); await openSettings();
  assert.equal(await page.getByLabel('提交并下一条绑定').inputValue(), 'Shift+KeyT');
  await page.getByRole('button', { name: '恢复默认', exact: true }).first().click();
  assert.equal(await page.getByLabel('提交并下一条绑定').inputValue(), 'KeyG, Enter, NumpadEnter');
  await page.getByRole('button', { name: '保存快捷键', exact: true }).click();
  await visible(page.getByText('已保存', { exact: true }));
  assert.deepEqual((await request('/me/settings')).shortcut_overrides, {});
  await page.getByLabel('提交并下一条绑定').fill('Shift+KeyT');
  await page.getByRole('button', { name: '保存快捷键', exact: true }).click();
  await visible(page.getByText('已保存', { exact: true }));
  await returnFromSettings();
  record('仅用户名/无显示名及切换账号、密码二次确认/错误/成功清空、快捷键保存/恢复/刷新、跨组织共用、member 管理入口隐藏');

  await sameTab(page.getByRole('link', { name: '本地工作区', exact: true }));
  await page.getByLabel('导入本地视频', { exact: true }).setInputFiles(join(dir, 'local.mp4'));
  await wait(() => document.querySelector('video').readyState >= 1);
  // TimePointControl's label includes its input; use labels rather than internals.
  const start = page.getByRole('textbox', { name: '入点', exact: true });
  const end = page.getByRole('textbox', { name: '出点', exact: true });
  await start.fill('0:00:00.00'); await end.fill('0:00:02.00');
  await page.locator('.audio-stage').focus(); await page.keyboard.press('Shift+KeyT');
  await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  await page.getByLabel('字幕中文文本').fill('会话保护稿件');
  await start.fill('0:00:00.30'); await end.fill('0:00:01.90');
  const snapshot = await preserveSnapshot();
  // Same DOM nodes and object URL must survive session invalidation and re-login.
  await page.evaluate(() => { window.__testVideo = document.querySelector('video'); window.__testTimeInput = document.querySelector('input[aria-label="入点"]'); });
  const sibling = await context.newPage();
  await sibling.goto('/');
  await sameTab(sibling.getByRole('link', { name: '设置', exact: true }));
  await sibling.getByRole('button', { name: '退出账号', exact: true }).click();
  await sibling.getByRole('button', { name: '登录', exact: true }).waitFor();
  await sibling.close();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await visible(page.getByRole('button', { name: '重新登录', exact: true }));
  assert.deepEqual(await preserveSnapshot(), snapshot);
  await page.getByRole('button', { name: '重新登录', exact: true }).click();
  await visible(dialog('重新登录'));
  await page.keyboard.press('Escape'); // close login; no workspace reset
  await page.getByRole('button', { name: '重新登录', exact: true }).click();
  await login();
  await hidden(dialog('重新登录'));
  assert.deepEqual(await preserveSnapshot(), snapshot);
  assert(await page.evaluate(() => window.__testVideo === document.querySelector('video') && window.__testTimeInput === document.querySelector('input[aria-label="入点"]')));
  record('跨标签页退出和同账号重新登录保留字幕、时间草稿、选中行及同一个 video');

  // Browser-side cookie expiry also preserves the live editor before reauthentication.
  await context.clearCookies({ name: 'sessionid' });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await visible(page.getByRole('button', { name: '重新登录', exact: true }));
  assert.deepEqual(await preserveSnapshot(), snapshot);
  await page.getByRole('button', { name: '重新登录', exact: true }).click();
  await login(); await hidden(dialog('重新登录'));
  assert.deepEqual(await preserveSnapshot(), snapshot);
  // A different account in another tab is observed before any workspace replacement.
  await request('/auth/login', 'POST', { username: 'browser-bob', password });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await visible(dialog('切换到账号 browser-bob'));
  assert.deepEqual(await preserveSnapshot(), snapshot);
  await dialog('切换到账号 browser-bob').getByRole('button', { name: '取消', exact: true }).click();
  await login(); await hidden(dialog('重新登录'));
  assert.deepEqual(await preserveSnapshot(), snapshot);
  record('Cookie 到期和其他标签页换号均保留原稿，取消换号后可原账号继续');


  await openSettings();
  await page.keyboard.press('Shift+KeyT');
  assert.deepEqual(await preserveSnapshot(), snapshot);
  await page.getByRole('button', { name: '录制', exact: true }).first().click();
  await page.getByLabel('录制快捷键').press('Shift+KeyT');
  assert.deepEqual(await preserveSnapshot(), snapshot);
  await returnFromSettings();
  await openMembers();
  await page.keyboard.press('Shift+KeyT');
  assert.deepEqual(await preserveSnapshot(), snapshot);
  await returnFromSettings('organization');
  await page.locator('main:visible').focus();
  await page.keyboard.press('KeyG');
  assert.equal((await preserveSnapshot()).selected, snapshot.selected);
  await page.keyboard.press('Shift+KeyT');
  assert.notEqual((await preserveSnapshot()).selected, snapshot.selected);
  assert.equal(await page.getByLabel('字幕中文文本').inputValue(), '');
  await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  assert.equal(await page.getByLabel('字幕中文文本').inputValue(), '会话保护稿件');
  record('快捷键覆盖、未配置键无效、个人设置/录制/组织设置页面暂停全局快捷键');

  const orgA = orgs.organizations.find(org => org.role === 'organizer');
  await page.getByRole('link', { name: 'CueRelay', exact: true }).click();
  await page.getByLabel('当前组织', { exact: true }).selectOption(String(orgA.id));
  await visible(dialog('切换组织'));
  const downloadPromise = page.waitForEvent('download');
  await dialog('切换组织').getByRole('button', { name: '导出 ASS', exact: true }).click();
  const download = await downloadPromise;
  assert(readFileSync(await download.path(), 'utf8').includes('会话保护稿件'));
  await dialog('切换组织').getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.getByLabel('字幕中文文本').inputValue(), '会话保护稿件');
  await openSettings(); await page.getByRole('button', { name: '退出账号', exact: true }).click();
  await visible(dialog('退出账号')); await dialog('退出账号').getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(page.url(), personalSettingsURL);
  await returnFromSettings();
  assert.equal(await page.getByLabel('字幕中文文本').inputValue(), '会话保护稿件');
  // Removing oneself through the member row uses the same guarded leave path.
  await page.getByRole('link', { name: 'CueRelay', exact: true }).click();
  await page.getByLabel('当前组织', { exact: true }).selectOption(String(orgA.id));
  await dialog('切换组织').getByRole('button', { name: '明确放弃并继续', exact: true }).click();
  await hidden(dialog('切换组织'));
  await sameTab(page.getByRole('link', { name: '本地工作区', exact: true }));
  await page.getByRole('textbox', { name: '出点', exact: true }).fill('0:00:01.00');
  await page.locator('.audio-stage').focus(); await page.keyboard.press('Shift+KeyT');
  await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  await page.getByLabel('字幕中文文本').fill('会话保护稿件');
  await openMembers();
  await page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'browser-alice', exact: true }) }).getByRole('button', { name: '移除' }).click();
  await visible(dialog('退出此组织'));
  await dialog('退出此组织').getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.getByLabel('字幕中文文本').inputValue(), '会话保护稿件');
  record('切组织/主动退出/成员表移除自己均先处理稿件，导出或取消有效');

  // Different-account login in a sibling tab must pause at a discard decision.
  await request('/auth/logout', 'POST', {});
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await visible(page.getByRole('button', { name: '重新登录', exact: true }));
  await page.getByRole('button', { name: '重新登录', exact: true }).click();
  await login('browser-bob');
  await visible(dialog('切换到账号 browser-bob'));
  assert.equal(await page.getByLabel('字幕中文文本').inputValue(), '会话保护稿件');
  await dialog('切换到账号 browser-bob').getByRole('button', { name: '明确放弃并继续', exact: true }).click();
  await hidden(dialog('切换到账号 browser-bob'));
  await sameTab(page.getByRole('link', { name: '本地工作区', exact: true }));
  await wait(() => document.querySelector('textarea').value === '');
  await openSettings();
  assert.equal(await page.getByLabel('提交并下一条绑定').inputValue(), 'KeyG, Enter, NumpadEnter');
  await returnFromSettings();
  record('换账号必须明确放弃、旧稿件不归新账号、个人设置隔离');
  await page.screenshot({ path: join(dir, 'workbench.png'), fullPage: true });
  // No-organization state is explicit and still permits local format tooling.
  await sameTab(page.getByRole('link', { name: '设置', exact: true }));
  await page.getByRole('button', { name: '退出账号', exact: true }).click();
  await login('browser-empty');
  await visible(page.getByText('暂无组织。请联系 dev 或 organizer 添加成员；仍可使用本地工作区。', { exact: true }));
  record('无组织空状态');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: browser.version(), checks, errors, artifacts: dir }, null, 2));
} catch (error) {
  console.error('URL', page.url(), 'UI', await page.locator('body').innerText());
  await page.screenshot({ path: join(dir, 'failure.png'), fullPage: true });
  throw error;
} finally { await browser.close(); }
