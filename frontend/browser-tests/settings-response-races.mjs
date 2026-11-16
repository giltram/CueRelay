// Actual App with controlled settings response ordering; no application database.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { installI18nFixtures } from './i18n-fixtures.mjs';

const origin = process.env.SETTINGS_RACES_URL || 'http://127.0.0.1:5240';
const browser = await chromium.launch({ headless: true });
const only = process.argv[2];
const languageControl = page => page.locator('main:visible .language-control select');
const audioControl = page => page.locator('.settings-content select').first();
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function remountPersonal(page) {
  await page.getByRole('link', { name: 'Organization settings', exact: true }).click();
  await page.getByRole('link', { name: 'Personal settings', exact: true }).click();
}
async function loginBeforeSettings(f) {
  f.state.anonymous = true;
  const firstRead = f.holdNext('GET');
  await f.page.goto(origin + '/organizations/1/settings/personal');
  await f.page.getByLabel('用户名', { exact: true }).fill('language-user-one');
  await f.page.getByLabel('密码', { exact: true }).fill('fixture-test-password');
  await f.page.getByRole('button', { name: '登录', exact: true }).click();
  return firstRead;
}
async function refreshSettings(f) {
  const received = f.page.waitForResponse(response => response.url().endsWith('/api/me/settings') && response.request().method() === 'GET');
  await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await (await received).finished(); await settle(f.page);
}

async function fixture() {
  const context = await browser.newContext({ locale: 'zh-CN' });
  const { state, errors } = await installI18nFixtures(context, Buffer.from('unused-media'));
  const settings = { language_preference: 'zh-CN', handbook_seen: true,
    shortcut_overrides: {}, audio_display_mode: 'spectrum', mouse_sets_cue_boundary: true };
  const holds = new Map();
  let reads = 0;
  await context.route('**/api/me/settings', route => {
    const method = route.request().method();
    if (method === 'GET') reads++;
    else {
      assert.equal(method, 'PATCH');
      Object.assign(settings, route.request().postDataJSON());
    }
    // Commit first, then retain the response snapshot, just as a delayed server response does.
    const snapshot = structuredClone(settings);
    const capture = holds.get(method);
    if (capture) { holds.delete(method); capture({ route, snapshot }); return; }
    return route.fulfill({ json: snapshot });
  });
  const page = await context.newPage();
  const holdNext = method => {
    assert(!holds.has(method));
    const captured = Promise.withResolvers(); holds.set(method, captured.resolve);
    return captured.promise;
  };
  async function release({ route, snapshot }, response = { json: snapshot }) {
    const received = page.waitForResponse(response => response.request() === route.request());
    await route.fulfill(response);
    await (await received).finished(); await settle(page);
  }
  async function ready() {
    await page.goto(origin + '/organizations/1/settings/personal');
    await expect(languageControl(page)).toHaveValue('zh-CN');
    await expect(page.locator('.shortcut-row').first()).toBeVisible();
  }
  return { context, page, state, errors, settings, holdNext, release, ready, readCount: () => reads };
}

async function initialSettings() {
  const f = await fixture();
  try {
    // These fields must come from the initial GET, rather than placeholder defaults.
    Object.assign(f.settings, { audio_display_mode: 'waveform', mouse_sets_cue_boundary: false,
      shortcut_overrides: { commit: ['Shift+KeyT'] } });
    const held = await loginBeforeSettings(f);
    await languageControl(f.page).selectOption('en');
    await expect(languageControl(f.page)).toBeEnabled();
    assert.equal(f.settings.language_preference, 'en');
    await expect(languageControl(f.page)).toHaveValue('en');
    await expect(f.page.locator('html')).toHaveAttribute('lang', 'en');
    await f.release(held);
    await expect(f.page.locator('.shortcut-row').first()).toBeVisible();
    await expect(languageControl(f.page)).toHaveValue('en');
    await expect(f.page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(audioControl(f.page)).toHaveValue('waveform');
    await expect(f.page.getByLabel('Set subtitle boundaries with mouse clicks', { exact: true })).not.toBeChecked();
    await expect(f.page.getByLabel('Commit and move to next line binding', { exact: true })).toHaveValue('Shift+KeyT');
    assert.equal(f.readCount(), 1, 'Initial hydration must finish without waiting for another observation');
    assert.deepEqual(f.errors, []);
    console.log('PASS initial GET: login + language save finishes hydration and preserves unrelated server fields');
  } finally { await f.context.close(); }
}

async function remotePreferenceAfterInitialSave(order) {
  const f = await fixture();
  try {
    const held = await loginBeforeSettings(f);
    await languageControl(f.page).selectOption('en');
    await expect(languageControl(f.page)).toBeEnabled();
    assert.equal(f.settings.language_preference, 'en');
    await expect(languageControl(f.page)).toHaveValue('en');
    if (order === 'initial-first') await f.release(held);
    // Another window commits zh-CN after this window's successful language save.
    f.settings.language_preference = 'zh-CN';
    await refreshSettings(f);
    await expect(f.page.locator('.shortcut-row').first()).toBeVisible();
    await expect(languageControl(f.page)).toHaveValue('zh-CN');
    await expect(f.page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    if (order === 'remote-first') await f.release(held);
    for (let count = 0; count < 2; count++) {
      await refreshSettings(f);
      await expect(languageControl(f.page)).toHaveValue('zh-CN');
      await expect(f.page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    }
    assert.equal(f.settings.language_preference, 'zh-CN');
    assert.equal(f.readCount(), 4);
    assert.deepEqual(f.errors, []);
    console.log(`PASS saved choice ${order}: fresh remote preference wins, including two later refreshes`);
  } finally { await f.context.close(); }
}

async function pendingAndFailedChoice() {
  const f = await fixture();
  try {
    const initial = await loginBeforeSettings(f);
    const pending = f.holdNext('PATCH');
    await languageControl(f.page).selectOption('en');
    const patch = await pending;
    f.settings.language_preference = 'zh-CN';
    await refreshSettings(f);
    await expect(f.page.locator('.shortcut-row').first()).toBeVisible();
    await expect(languageControl(f.page)).toBeDisabled();
    await expect(languageControl(f.page)).toHaveValue('en');
    await f.release(patch, { status: 503, json: { error: { code: 'unavailable', message: 'fixture failed language save' } } });
    await expect(languageControl(f.page)).toBeEnabled();
    await expect(f.page.locator('.language-control [role=alert]')).toContainText('fixture failed language save');
    await f.release(initial);
    await refreshSettings(f);
    await expect(languageControl(f.page)).toHaveValue('en');
    const retry = f.page.getByRole('button', { name: 'Retry', exact: true });
    await expect(retry).toBeVisible();
    await retry.click();
    await expect(f.page.locator('.language-control [role=alert]')).toHaveCount(0);
    await expect(languageControl(f.page)).toBeEnabled();
    assert.equal(f.settings.language_preference, 'en');
    f.settings.language_preference = 'zh-CN';
    await refreshSettings(f);
    await expect(languageControl(f.page)).toHaveValue('zh-CN');
    await expect(f.page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    assert.deepEqual(f.errors, []);
    console.log('PASS choice lifecycle: pending/failed choice survives hydration; successful retry yields to remote refresh');
  } finally { await f.context.close(); }
}

async function delayedPersonalPatch(kind) {
  const f = await fixture();
  try {
    await f.ready();
    const pending = f.holdNext('PATCH');
    if (kind === 'audio') {
      await audioControl(f.page).selectOption('waveform');
      await f.page.getByRole('button', { name: '保存显示设置', exact: true }).click();
    } else {
      await f.page.getByLabel('提交并下一条绑定', { exact: true }).fill('Shift+KeyT');
      await f.page.getByLabel('鼠标点击设置字幕边界', { exact: true }).uncheck();
      await f.page.getByRole('button', { name: '保存快捷键', exact: true }).click();
    }
    const held = await pending;
    await languageControl(f.page).selectOption('en');
    await expect(languageControl(f.page)).toBeEnabled();
    await expect(f.page.locator('html')).toHaveAttribute('lang', 'en');
    await f.release(held);
    await expect(languageControl(f.page)).toHaveValue('en');
    await expect(f.page.locator('html')).toHaveAttribute('lang', 'en');
    assert.equal(f.settings.language_preference, 'en');
    // Remount the form to inspect App's merged values rather than the old local drafts.
    await remountPersonal(f.page);
    if (kind === 'audio') await expect(audioControl(f.page)).toHaveValue('waveform');
    else {
      await expect(f.page.getByLabel('Commit and move to next line binding', { exact: true })).toHaveValue('Shift+KeyT');
      await expect(f.page.getByLabel('Set subtitle boundaries with mouse clicks', { exact: true })).not.toBeChecked();
    }
    assert.equal(f.readCount(), 1, 'Form values must come from App without another settings GET');
    assert.deepEqual(f.errors, []);
    console.log(`PASS ${kind} PATCH: old full response cannot overwrite a later successful language save`);
  } finally { await f.context.close(); }
}

async function delayedLanguagePatch() {
  const f = await fixture();
  try {
    await f.ready();
    const pending = f.holdNext('PATCH');
    await languageControl(f.page).selectOption('en');
    const held = await pending;
    await audioControl(f.page).selectOption('waveform');
    await f.page.getByRole('button', { name: 'Save display settings', exact: true }).click();
    await expect(audioControl(f.page)).toBeEnabled();
    await f.release(held);
    await expect(languageControl(f.page)).toHaveValue('en');
    // Remount PersonalPanel so its initial input reflects App's accepted settings.
    await remountPersonal(f.page);
    await expect(audioControl(f.page)).toHaveValue('waveform');
    assert.equal(f.settings.audio_display_mode, 'waveform');
    assert.equal(f.readCount(), 1);
    assert.deepEqual(f.errors, []);
    console.log('PASS language PATCH: old full response preserves a later successful audio save');
  } finally { await f.context.close(); }
}

try {
  if (!only || only === 'remote') for (const order of ['remote-first', 'initial-first']) await remotePreferenceAfterInitialSave(order);
  if (!only || only === 'lifecycle') await pendingAndFailedChoice();
  if (!only || only === 'initial') await initialSettings();
  if (!only || only === 'personal') for (const kind of ['audio', 'shortcuts']) await delayedPersonalPatch(kind);
  if (!only || only === 'language') await delayedLanguagePatch();
} finally { await browser.close(); }
