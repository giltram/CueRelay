// Real App, history, IndexedDB and media; controlled HTTP saves, no application database.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { installI18nFixtures } from './i18n-fixtures.mjs';
import { sameTab } from './link-navigation.mjs';

const origin = process.env.WORKSPACE_NAVIGATION_URL || 'http://127.0.0.1:5241';
const directory = mkdtempSync(join(tmpdir(), 'cuerelay-workspace-navigation-'));
const video = join(directory, 'video.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=8',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
let browser;
const projectPath = '/organizations/1/projects/7/workspace';
const button = (page, name) => page.getByRole('button', { name, exact: true });
const home = page => page.getByRole('link', { name: 'CueRelay', exact: true });
const text = page => page.getByLabel('字幕中文文本', { exact: true });
const guard = page => page.getByRole('dialog', { name: '离开工作区', exact: true });

async function fixture(language = 'zh-CN') {
  const context = await browser.newContext({ locale: language, viewport: { width: 1440, height: 1000 } });
  const { state, errors } = await installI18nFixtures(context, readFileSync(video));
  state.preferences[1] = language;
  const saves = [];
  const control = { hold: false, fail: false };
  await context.route('**/api/organizations/1/projects/7/document', async route => {
    const data = route.request().postDataJSON();
    const save = { data, route };
    saves.push(save);
    if (!control.hold) await finishSave(save);
  });
  async function finishSave({ route, data }, fail = control.fail) {
    if (fail) return route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'Save failed for navigation test' } } });
    assert.equal(data.revision, state.project.revision);
    state.project = { ...state.project, document: data.document, revision: state.project.revision + 1 };
    await route.fulfill({ json: { project: state.project } });
  }
  const page = await context.newPage();
  const nativePrompts = [];
  page.on('dialog', async dialog => { nativePrompts.push(dialog.type()); await dialog.dismiss(); });
  async function openProject() {
    await page.goto(origin + projectPath);
    await page.getByLabel(language === 'en' ? 'Import local video' : '导入本地视频', { exact: true }).setInputFiles(video);
    await button(page, language === 'en' ? 'Select line 1' : '选择第 1 行').click();
    await expect(page.locator('.subtitle-input textarea')).toBeEnabled();
  }
  async function close() { assert.deepEqual(errors, []); await context.close(); }
  return { context, page, state, errors, saves, control, nativePrompts, finishSave, openProject, close };
}

async function cleanAndSaved() {
  const f = await fixture();
  try {
    const { page } = f;
    await f.openProject();
    const original = await text(page).inputValue();
    // Reverting by editing creates a different document object with equal content.
    await text(page).fill('temporary edit'); await text(page).fill(original);
    await expect(button(page, '保存项目')).toBeDisabled();
    await home(page).click(); await expect(page).toHaveURL(origin + '/');
    await button(page, '新建项目').click();
    await expect(page.getByLabel('项目名称', { exact: true })).toBeVisible();
    await button(page, '取消').click();
    await page.goBack();
    await expect(page).toHaveURL(origin + projectPath);
    // Opening creation intentionally replaces the previous clean instance.
    await page.getByLabel('导入本地视频', { exact: true }).setInputFiles(video);
    await button(page, '选择第 1 行').click();
    await expect(text(page)).toBeEnabled();
    await text(page).fill('saved edit'); await button(page, '保存项目').click();
    await expect(page.getByText('项目已保存。尚未应用的时间输入不包含在本次保存中。', { exact: true })).toBeVisible();
    await home(page).click(); await expect(page).toHaveURL(origin + '/');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goBack(); await expect(text(page)).toHaveValue('saved edit');
    // A saved project with a video must not trigger the native unload warning either.
    await page.reload(); await expect(page.locator('.subtitle-input textarea')).toBeVisible();
    assert.deepEqual(f.nativePrompts, []);
    assert.equal(f.saves.length, 1);
  } finally { await f.close(); }
  console.log('PASS clean: reverted/saved projects leave without prompts; new project opens directly; clean reload has no warning');
}

async function saveBeforeNavigation() {
  const f = await fixture();
  try {
    const { page } = f;
    await f.openProject(); await text(page).fill('save before leaving');
    const editor = await text(page).elementHandle();
    await home(page).click();
    await expect(guard(page)).toBeVisible(); await expect(page).toHaveURL(origin + projectPath);
    await button(page, '取消').click();
    await expect(text(page)).toHaveValue('save before leaving');
    assert(await editor.evaluate(node => node === document.querySelector('.subtitle-input textarea')));
    await sameTab(page.getByRole('link', { name: '设置', exact: true }));
    await expect(guard(page)).toBeVisible(); await expect(page).toHaveURL(origin + projectPath);
    await expect(page.getByRole('heading', { name: '个人设置', exact: true })).toHaveCount(0);
    f.control.hold = true;
    await button(page, '保存并离开').click();
    await expect.poll(() => f.saves.length).toBe(1);
    await expect(page).toHaveURL(origin + projectPath);
    await expect(button(page, '明确放弃并继续')).toBeDisabled();
    await f.finishSave(f.saves[0], true);
    await expect(guard(page).getByRole('status')).toContainText('Save failed');
    await expect(button(page, '保存并离开')).toBeEnabled();
    await expect(page).toHaveURL(origin + projectPath);
    await button(page, '保存并离开').click();
    await expect.poll(() => f.saves.length).toBe(2);
    await f.finishSave(f.saves[1], false);
    await expect(page).toHaveURL(origin + '/organizations/1/settings/personal');
    await home(page).click(); await button(page, '新建项目').click();
    await expect(page.getByLabel('项目名称', { exact: true })).toBeVisible();
    assert.equal(f.state.project.document.cues[0].text, 'save before leaving');
  } finally { await f.close(); }
  console.log('PASS save: prompt precedes route/settings; cancellation retains editor; pending/failed saves stay; success leaves without repeated warning');
}

async function timingAndDiscard() {
  const f = await fixture();
  try {
    const { page } = f;
    await f.openProject();
    await text(page).fill('saved document, pending timing');
    await page.getByLabel('入点', { exact: true }).fill('0:00:00.10');
    await button(page, '保存项目').click();
    await expect(page.getByText('项目已保存。尚未应用的时间输入不包含在本次保存中。', { exact: true })).toBeVisible();
    await home(page).click(); await expect(guard(page)).toBeVisible();
    await expect(button(page, '保存并离开')).toBeDisabled();
    await expect(guard(page)).toContainText('尚未应用的时间输入');
    await button(page, '取消').click();
    await expect(page.getByLabel('入点', { exact: true })).toHaveValue('0:00:00.10');
    // Download is a backup and must not silently apply timing or leave the page.
    await home(page).click();
    const downloaded = page.waitForEvent('download');
    await button(page, '导出 ASS').click();
    assert.match(readFileSync(await (await downloaded).path(), 'utf8'), /saved document, pending timing/);
    await expect(guard(page)).toBeVisible(); await expect(page).toHaveURL(origin + projectPath);
    await button(page, '明确放弃并继续').click();
    await expect(page).toHaveURL(origin + '/');
    await expect(page.locator('video')).toHaveCount(0);
    await button(page, '新建项目').click();
    await expect(page.getByLabel('项目名称', { exact: true })).toBeVisible();
    await button(page, '取消').click(); await page.goBack();
    await expect(page).toHaveURL(origin + projectPath);
    await button(page, '选择第 1 行').click();
    await expect(text(page)).toHaveValue('saved document, pending timing');
    await expect(page.getByLabel('入点', { exact: true })).toHaveValue('0:00:00.00');
    await expect(page.locator('[data-workspace-drafts]')).toHaveCount(0);
    assert.equal(f.state.project.document.cues[0].start_ms, 0);
  } finally { await f.close(); }
  console.log('PASS timing: ordinary save does not hide unapplied inputs; export stays; discard removes memory/draft without deleting saved project');
}

async function historyAndNewTab() {
  const f = await fixture();
  try {
    const { page, context } = f;
    await page.goto(origin + '/');
    await sameTab(page.getByRole('link', { name: f.state.project.name, exact: true }));
    await page.getByLabel('导入本地视频', { exact: true }).setInputFiles(video);
    await button(page, '选择第 1 行').click(); await expect(text(page)).toBeEnabled();
    await text(page).fill('history edit');
    // The default new-tab action leaves the source workspace untouched.
    const opened = context.waitForEvent('page');
    await page.getByRole('link', { name: '项目列表', exact: true }).click();
    const list = await opened; await expect(list.getByRole('heading', { name: '项目', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(text(page)).toHaveValue('history edit'); await list.close();
    await page.goBack(); await expect(guard(page)).toBeVisible();
    await expect(page).toHaveURL(origin + projectPath);
    await button(page, '取消').click(); await expect(text(page)).toHaveValue('history edit');
    await page.goBack(); await button(page, '保存并离开').click();
    await expect(page).toHaveURL(origin + '/');
    await page.goForward(); await expect(text(page)).toHaveValue('history edit');
    await text(page).fill('discarded edit');
    await page.goBack(); await button(page, '明确放弃并继续').click();
    await expect(page).toHaveURL(origin + '/');
    await page.goForward(); await expect(page).toHaveURL(origin + projectPath);
    await button(page, '选择第 1 行').click(); await expect(text(page)).toHaveValue('history edit');
  } finally { await f.close(); }
  console.log('PASS history: back prompts before leaving; cancel/save/discard and forward work; new tabs retain dirty source without prompting');
}

async function localAndEnglish() {
  const f = await fixture();
  try {
    const { page } = f;
    await page.goto(origin + '/workspace/local'); await expect(text(page)).toBeEnabled();
    await home(page).click(); await expect(page).toHaveURL(origin + '/');
    await page.goBack(); await expect(text(page)).toBeEnabled();
    await page.getByLabel('入点', { exact: true }).fill('0:');
    await home(page).click(); await expect(guard(page)).toBeVisible();
    await expect(button(page, '保存并离开')).toHaveCount(0);
    await button(page, '取消').click(); await expect(page.getByLabel('入点', { exact: true })).toHaveValue('0:');
    await home(page).click(); await button(page, '明确放弃并继续').click();
    await expect(page).toHaveURL(origin + '/');
  } finally { await f.close(); }
  const en = await fixture('en');
  try {
    const { page } = en;
    await en.openProject(); await page.locator('.subtitle-input textarea').fill('English draft');
    await home(page).click();
    await expect(page.getByRole('dialog', { name: 'Leave workspace', exact: true })).toBeVisible();
    await button(page, 'Save and leave').click(); await expect(page).toHaveURL(origin + '/');
  } finally { await en.close(); }
  console.log('PASS local/English: clean blank leaves; invalid time-only draft prompts and survives cancel; English save and leave works');
}

try {
  browser = await chromium.launch({ headless: true });
  await cleanAndSaved();
  await saveBeforeNavigation();
  await timingAndDiscard();
  await historyAndNewTab();
  await localAndEnglish();
} finally { await browser?.close(); rmSync(directory, { recursive: true, force: true }); }
