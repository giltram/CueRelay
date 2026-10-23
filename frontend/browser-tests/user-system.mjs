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
async function request(path, method = 'GET', data) {
  await context.request.get('/api/auth/session');
  const token = (await context.cookies()).find(cookie => cookie.name === 'csrftoken').value;
  const response = await context.request.fetch('/api' + path, { method, data, headers: { 'X-CSRFToken': token } });
  assert(response.ok(), `${method} ${path}: ${await response.text()}`);
  return response.json();
}
async function openSettings() { await page.getByRole('button', { name: '测试甲', exact: true }).click(); await visible(dialog('个人设置')); }
async function close(title) { await dialog(title).getByRole('button', { name: '关闭', exact: true }).click(); }
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
  await page.getByRole('button', { name: '本地工作区', exact: true }).click();
  await visible(page.locator('video'));
  await wait(() => document.querySelector('#organization').selectedOptions[0].textContent.includes('organizer'));
  record('会话初始化、登录失败、登录后组织上下文');

  await page.getByRole('button', { name: '成员', exact: true }).click();
  await visible(page.getByLabel('browser-alice角色'));
  await page.getByLabel('browser-alice角色').selectOption('member');
  await visible(page.getByText('组织必须至少保留一名活动 organizer。', { exact: true }));
  await page.getByLabel('准确用户名').fill('browser-empty');
  await page.getByRole('button', { name: '添加已有账号' }).click();
  await visible(page.getByLabel('browser-empty角色'));
  await page.getByLabel('browser-empty角色').selectOption('organizer');
  await wait(() => document.querySelector('select[aria-label="browser-empty角色"]').value === 'organizer');
  await page.getByLabel('browser-empty角色').selectOption('member');
  await page.getByRole('row').filter({ hasText: '(browser-empty)' }).getByRole('button', { name: '移除' }).click();
  await hidden(page.getByLabel('browser-empty角色'));
  await close('组织成员');
  record('成员添加、角色调整、移除、最后 organizer 保护');

  await openSettings();
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await visible(page.getByText('已保存', { exact: true }));
  await page.getByLabel('旧密码', { exact: true }).fill('wrong');
  await page.getByLabel('新密码', { exact: true }).fill(password + '-new');
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await visible(page.getByText('旧密码不正确。', { exact: true }));
  await page.getByLabel('旧密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await visible(page.getByText('已保存', { exact: true }));
  await page.getByLabel('旧密码', { exact: true }).fill(password + '-new');
  await page.getByLabel('新密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await visible(page.getByText('已保存', { exact: true }));
  await page.getByLabel('应用时间绑定').fill('Shift+KeyT');
  await page.getByRole('button', { name: '保存快捷键', exact: true }).click();
  await visible(page.getByText('已保存', { exact: true }));
  await close('个人设置');
  await page.reload(); await page.getByRole('button', { name: '本地工作区', exact: true }).click(); await visible(page.locator('video')); await openSettings();
  assert.equal(await page.getByLabel('应用时间绑定').inputValue(), 'Shift+KeyT');
  await close('个人设置');
  const orgs = await request('/organizations');
  const orgB = orgs.organizations.find(org => org.role === 'member');
  await page.getByLabel('当前组织', { exact: true }).selectOption(String(orgB.id));
  await page.getByRole('button', { name: '成员', exact: true }).click();
  await visible(dialog('组织成员'));
  assert.equal(await page.getByLabel('准确用户名').count(), 0);
  assert.equal(await page.getByLabel('组织名称').count(), 0);
  await close('组织成员'); await openSettings();
  assert.equal(await page.getByLabel('应用时间绑定').inputValue(), 'Shift+KeyT');
  await page.getByRole('button', { name: '恢复默认', exact: true }).first().click();
  assert.equal(await page.getByLabel('应用时间绑定').inputValue(), 'KeyG, Enter, NumpadEnter');
  await page.getByRole('button', { name: '保存快捷键', exact: true }).click();
  await visible(page.getByText('已保存', { exact: true }));
  assert.deepEqual((await request('/me/settings')).shortcut_overrides, {});
  await page.getByLabel('应用时间绑定').fill('Shift+KeyT');
  await page.getByRole('button', { name: '保存快捷键', exact: true }).click();
  await visible(page.getByText('已保存', { exact: true }));
  await close('个人设置');
  record('资料与改密、快捷键保存/恢复/刷新、跨组织共用、member 管理入口隐藏');

  await page.getByRole('button', { name: '本地工作区', exact: true }).click();
  await page.getByLabel('导入本地视频', { exact: true }).setInputFiles(join(dir, 'local.mp4'));
  await wait(() => document.querySelector('video').readyState >= 1);
  // TimePointControl's label includes its input; use labels rather than internals.
  const start = page.getByRole('textbox', { name: '入点', exact: true });
  const end = page.getByRole('textbox', { name: '出点', exact: true });
  await start.fill('0:00:00.00'); await end.fill('0:00:02.00');
  await page.getByRole('button', { name: '创建新行 [N]', exact: true }).click();
  await page.getByLabel('字幕中文文本').fill('会话保护稿件');
  await start.fill('0:00:00.30'); await end.fill('0:00:01.90');
  const snapshot = await preserveSnapshot();
  // Same DOM nodes and object URL must survive session invalidation and re-login.
  await page.evaluate(() => { window.__testVideo = document.querySelector('video'); window.__testTimeInput = document.querySelector('input[aria-label="入点"]'); });
  const sibling = await context.newPage();
  await sibling.goto('/');
  await sibling.getByRole('button', { name: '测试甲', exact: true }).click();
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
  await close('个人设置');
  await page.getByRole('button', { name: '成员', exact: true }).click();
  await page.keyboard.press('Shift+KeyT');
  assert.deepEqual(await preserveSnapshot(), snapshot);
  await close('组织成员');
  await page.locator('h1').click();
  await page.keyboard.press('KeyG');
  assert.equal((await preserveSnapshot()).selected, snapshot.selected);
  await page.keyboard.press('Shift+KeyT');
  assert.notEqual((await preserveSnapshot()).selected, snapshot.selected);
  record('快捷键覆盖、未配置键无效、个人设置/录制/成员弹窗暂停全局快捷键');

  const orgA = orgs.organizations.find(org => org.role === 'organizer');
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
  assert.equal(await page.getByLabel('字幕中文文本').inputValue(), '会话保护稿件');
  // Removing oneself through the member row uses the same guarded leave path.
  await page.getByLabel('当前组织', { exact: true }).selectOption(String(orgA.id));
  await dialog('切换组织').getByRole('button', { name: '明确放弃并继续', exact: true }).click();
  await hidden(dialog('切换组织'));
  await page.getByRole('button', { name: '本地工作区', exact: true }).click();
  await page.getByRole('textbox', { name: '出点', exact: true }).fill('0:00:01.00');
  await page.getByRole('button', { name: '创建新行 [N]', exact: true }).click();
  await page.getByLabel('字幕中文文本').fill('会话保护稿件');
  await page.getByRole('button', { name: '成员', exact: true }).click();
  await page.getByRole('row').filter({ hasText: '(browser-alice)' }).getByRole('button', { name: '移除' }).click();
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
  await page.getByRole('button', { name: '本地工作区', exact: true }).click();
  await wait(() => document.querySelector('textarea').value === '');
  await page.getByRole('button', { name: '测试乙', exact: true }).click();
  assert.equal(await page.getByLabel('应用时间绑定').inputValue(), 'KeyG, Enter, NumpadEnter');
  await close('个人设置');
  record('换账号必须明确放弃、旧稿件不归新账号、个人设置隔离');
  await page.screenshot({ path: join(dir, 'workbench.png'), fullPage: true });
  // No-organization state is explicit and still permits local format tooling.
  await page.getByRole('button', { name: '测试乙', exact: true }).click();
  await page.getByRole('button', { name: '退出账号', exact: true }).click();
  await login('browser-empty');
  await visible(page.getByText('暂无组织。请联系 dev 或 organizer 添加成员；仍可使用本地工作区。', { exact: true }));
  record('无组织空状态');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: browser.version(), checks, errors, artifacts: dir }, null, 2));
} finally { await browser.close(); }
