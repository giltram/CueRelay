// Real Session/CSRF/project APIs plus the production audio editor; disposable fixtures only.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const password = process.env.BROWSER_TEST_PASSWORD;
if (!password) throw new Error('Set BROWSER_TEST_PASSWORD; seed the disposable project browser database first');
const baseURL = process.env.PROJECTS_URL || 'http://127.0.0.1:5185';
const directory = mkdtempSync(join(tmpdir(), 'cuerelay-integration-'));
const videoFile = join(directory, 'audio.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=8',
  '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-movflags', '+faststart', videoFile]);
const bytes = readFileSync(videoFile);
const wrong = Buffer.from(bytes); wrong[wrong.length - 1] ^= 1;
writeFileSync(join(directory, 'wrong.mp4'), wrong);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
context.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('dialog', dialog => dialog.accept());
const passed = [];
const check = message => { passed.push(message); console.log('PASS', message); };
async function api(path, method = 'GET', data) {
  await context.request.get('/api/auth/session');
  const csrf = (await context.cookies()).find(cookie => cookie.name === 'csrftoken').value;
  const response = await context.request.fetch(`/api${path}`, { method, data, headers: { 'X-CSRFToken': csrf } });
  assert(response.ok(), `${method} ${path}: ${await response.text()}`);
  return response.json();
}
const rows = page.locator('.cue-list tbody tr');
const start = page.getByRole('textbox', { name: '入点', exact: true });
const end = page.getByRole('textbox', { name: '出点', exact: true });
const stage = page.locator('.audio-stage');
const modal = name => page.getByRole('dialog', { name, exact: true });
const rowTimes = index => rows.nth(index).locator('.time-cell').allTextContents();
const guarded = () => page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })));
async function clickTime(time, button = 'left') {
  const view = await page.locator('.audio-timeline').evaluate(el => ({ start: Number(el.dataset.start), end: Number(el.dataset.end) }));
  const box = await stage.boundingBox();
  await stage.click({ button, position: { x: (time - view.start) / (view.end - view.start) * box.width, y: box.height * 0.65 } });
}
try {
  await page.goto('/');
  await page.getByLabel('用户名', { exact: true }).fill('project-organizer');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('button', { name: '本地工作区', exact: true }).click();
  await page.getByRole('button', { name: '选择第 1 行', exact: true }).waitFor();
  assert.equal(await guarded(), false);
  // App transitions must agree with beforeunload about the untouched default row.
  const organizations = (await api('/organizations')).organizations;
  const other = organizations.find(value => value.role === 'member');
  await page.getByLabel('当前组织', { exact: true }).selectOption(String(other.id));
  await page.getByRole('heading', { name: '项目', exact: true }).waitFor();
  assert.equal(await modal('切换组织').count(), 0);
  const org = organizations.find(value => value.role === 'organizer');
  await page.getByLabel('当前组织', { exact: true }).selectOption(String(org.id));
  await page.getByRole('button', { name: '本地工作区', exact: true }).click();
  await page.getByLabel('导入本地视频', { exact: true }).setInputFiles(videoFile);
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
  assert.equal(await guarded(), true);
  await page.getByLabel('当前组织', { exact: true }).selectOption(String(other.id));
  await modal('切换组织').waitFor();
  await modal('切换组织').getByRole('button', { name: '取消', exact: true }).click();
  check('默认首行不触发离页/切组织提示；仅加载视频也会保护本地内容');

  const base = `/organizations/${org.id}/projects`;
  const project = (await api(base, 'POST', { name: `音频集成 ${Date.now()}`, description: '',
    media: { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), duration_ms: 8000 },
    source: readFileSync('backend/ass_format/fixtures/basic.ass', 'utf8') })).project;
  const path = `${base}/${project.id}`;
  await page.getByRole('button', { name: '项目', exact: true }).click();
  await page.getByLabel('搜索项目', { exact: true }).fill(project.name);
  await page.locator('.project-table tbody tr').filter({ hasText: project.name }).getByRole('button', { name: '打开', exact: true }).click();
  await modal('打开其他项目').getByRole('button', { name: '明确放弃并继续', exact: true }).click();
  await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  const original = await rowTimes(0);
  await page.locator('main').focus();
  await page.keyboard.press('Control+Delete'); await page.keyboard.press('KeyG');
  assert.equal(await rows.count(), 2); assert.deepEqual(await rowTimes(0), original);
  assert(await page.getByLabel('字幕中文文本').isDisabled());
  await page.getByLabel('导入本地视频').setInputFiles(join(directory, 'wrong.mp4'));
  await page.getByRole('alert').filter({ hasText: 'SHA-256' }).waitFor();
  assert.equal(await page.locator('.audio-timeline').getAttribute('data-state'), 'empty');
  await page.getByLabel('导入本地视频').setInputFiles(videoFile);
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
  assert.equal(await guarded(), true);
  check('未验证项目禁止提交/删行；同大小错误 SHA-256 不进入音频分析；正确媒体启用时间轴');

  await clickTime(1.2); await clickTime(3.5, 'right');
  assert.equal(await start.inputValue(), '0:00:01.20'); assert.equal(await end.inputValue(), '0:00:03.50');
  assert.deepEqual(await rowTimes(0), original);
  await page.getByLabel('字幕中文文本').fill('音频交互保存回归');
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await page.getByText('项目已保存。尚未应用的时间输入不包含在本次保存中。', { exact: true }).waitFor();
  let saved = (await api(path)).project;
  assert.equal(saved.document.cues[0].start_ms, 1200);
  assert.equal(saved.document.cues[0].end_ms, 3400);
  await page.getByRole('button', { name: '项目管理员', exact: true }).click();
  await page.getByLabel('提交并下一条绑定').fill('Shift+KeyT');
  await page.getByRole('button', { name: '保存快捷键', exact: true }).click();
  await page.getByText('已保存', { exact: true }).waitFor();
  await page.keyboard.press('Control+Delete'); await page.keyboard.press('Shift+KeyT');
  assert.equal(await rows.count(), 2); assert.deepEqual(await rowTimes(0), original);
  await modal('个人设置').getByRole('button', { name: '关闭', exact: true }).click();
  await stage.focus(); await page.keyboard.press('KeyG');
  assert.deepEqual(await rowTimes(0), original);
  await page.keyboard.press('Shift+KeyT');
  assert.deepEqual(await rowTimes(0), ['0:00:01.20', '0:00:03.50']);
  assert.equal(await page.getByRole('button', { name: '选择第 2 行', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '保存项目', exact: true }).click();
  await page.getByText('项目已保存。尚未应用的时间输入不包含在本次保存中。', { exact: true }).waitFor();
  saved = (await api(path)).project;
  assert.equal(saved.document.cues[0].start_ms, 1200); assert.equal(saved.document.cues[0].end_ms, 3500);
  check('音频点击仅改草稿；保存不含未提交时间；个人覆盖键提交并下一行；设置弹窗阻止提交与删行');

  await page.getByRole('button', { name: 'Waveform', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
  const snapshot = await stage.evaluate(() => {
    window.__integrationVideo = document.querySelector('video');
    return { src: window.__integrationVideo.src, start: document.querySelector('input[aria-label="入点"]').value };
  });
  await page.getByRole('button', { name: '项目', exact: true }).click();
  await page.keyboard.press('Control+Delete'); await page.keyboard.press('Shift+KeyT');
  await page.getByRole('button', { name: '返回工作区', exact: true }).click();
  assert.equal(await page.locator('video').evaluate(video => video === window.__integrationVideo), true);
  assert.equal(await page.locator('video').getAttribute('src'), snapshot.src);
  assert.equal(await start.inputValue(), snapshot.start);
  assert.equal(await rows.count(), 2);
  assert.equal(await page.locator('.audio-timeline').getAttribute('data-mode'), 'waveform');
  await page.getByRole('button', { name: 'Spectrum', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
  saved = (await api(path)).project;
  await api(`${path}/archive`, 'POST', { revision: saved.revision });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText('已归档项目仅可查看和导出。', { exact: true }).waitFor();
  const archivedDraft = [await start.inputValue(), await end.inputValue()];
  await clickTime(1.8); await clickTime(3.8, 'right');
  await stage.focus(); await page.keyboard.press('Control+Delete'); await page.keyboard.press('Shift+KeyT');
  assert.deepEqual([await start.inputValue(), await end.inputValue()], archivedDraft);
  assert.equal(await rows.count(), 2);
  for (const boundary of await page.getByRole('slider', { name: /^字幕/ }).all()) assert(await boundary.isDisabled());
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 ASS', exact: true }).click();
  assert(readFileSync(await (await download).path(), 'utf8').includes('音频交互保存回归'));
  check('隐藏工作区暂停新快捷键并保留媒体/模式/草稿；归档阻止边界/提交/删行，仍可导出');
  await page.screenshot({ path: join(directory, 'integrated.png'), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed, errors, directory }, null, 2));
} catch (error) {
  console.error(await page.locator('body').innerText());
  await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true });
  throw error;
} finally {
  await api('/me/settings', 'PATCH', { shortcut_overrides: {} }).catch(() => {});
  await browser.close();
}
