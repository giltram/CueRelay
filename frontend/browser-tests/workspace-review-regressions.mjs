// Real App with controlled HTTP ordering and the Python ASS codec; no application database.
// Works against Vite dev or production preview.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { installI18nFixtures } from './i18n-fixtures.mjs';

const origin = process.env.WORKSPACE_REVIEW_URL || 'http://127.0.0.1:5240';
const browser = await chromium.launch({ headless: true });
const only = process.argv[2];
const languageControl = page => page.locator('main:visible .language-control select');
const settingsSnapshot = preference => ({ language_preference: preference, handbook_seen: true,
  shortcut_overrides: {}, audio_display_mode: 'spectrum', mouse_sets_cue_boundary: true });
// Let the response's promise continuation and React commit finish before asserting retention.
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function expiredExport() {
  const context = await browser.newContext({ locale: 'zh-CN' });
  try {
    const { state, errors } = await installI18nFixtures(context, Buffer.from('unused-media'));
    const page = await context.newPage();
    await page.goto(origin + '/workspace/local');
    const text = page.locator('.subtitle-input textarea');
    await expect(text).toBeEnabled();
    await text.fill('本地未保存字幕');
    // Retain the actual editor node across session observation.
    const editor = await text.elementHandle();
    const button = page.getByRole('button', { name: '导出 ASS', exact: true });
    state.anonymous = true;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByText('会话已失效或账号已变更。字幕、时间输入和视频保留在本页，请重新登录。')).toBeVisible();
    await expect(button).toBeEnabled();
    const downloaded = page.waitForEvent('download');
    await button.click();
    const download = await downloaded;
    assert.match(readFileSync(await download.path(), 'utf8'), /本地未保存字幕/);
    assert.equal(state.inspections, 1);
    assert.equal(state.exports, 1);
    await expect(text).toHaveValue('本地未保存字幕');
    assert(await editor.evaluate(node => node === document.querySelector('.subtitle-input textarea')));

    // Warnings still use the normal QC panel and allow a backup without authentication.
    await text.fill('');
    await button.click();
    const panel = page.locator('.subtitle-qc-panel');
    await expect(panel.locator('[data-qc-type="empty-text"]')).toBeVisible();
    const continued = page.waitForEvent('download');
    await panel.getByRole('button', { name: '继续导出 ASS', exact: true }).click();
    await continued;
    assert.equal(state.exports, 2);
    // Format errors remain blocking; session expiry never bypasses ASS validation.
    await text.fill('{\\pos(1,2)}invalid');
    await button.click();
    await expect(panel.locator('[data-qc-type="unsupported-ass"]')).toBeVisible();
    await expect(panel.getByRole('button', { name: '继续导出 ASS', exact: true })).toBeDisabled();
    assert.equal(state.exports, 2);
    assert.deepEqual(errors, []);
    console.log('PASS F1: expired session exports retained draft; warnings allow export; format errors block');
  } finally { await context.close(); }
}

async function staleSettings(order) {
  const context = await browser.newContext({ locale: 'zh-CN' });
  try {
    const { state, errors } = await installI18nFixtures(context, Buffer.from('unused-media'));
    const page = await context.newPage();
    await page.goto(origin + '/organizations/1/settings/personal');
    const control = languageControl(page);
    await expect(control).toHaveValue('zh-CN');
    await expect(page.locator('.shortcut-row').first()).toBeVisible();
    let held, captureRead;
    const captured = new Promise(resolve => { captureRead = resolve; });
    await context.route('**/api/me/settings', route => {
      if (route.request().method() !== 'GET' || held) return route.fallback();
      held = route; captureRead();
    });
    let releasePatch;
    state.settingsGate = new Promise(resolve => { releasePatch = resolve; });
    if (order === 'during-write') {
      await control.selectOption('en');
      await expect(control).toBeDisabled();
    }
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await captured;
    if (order !== 'during-write') {
      await control.selectOption('en');
      await expect(control).toBeDisabled();
    }
    async function releaseRead() {
      const response = page.waitForResponse(response => response.url().endsWith('/api/me/settings') && response.request().method() === 'GET');
      await held.fulfill({ json: settingsSnapshot('zh-CN') });
      await (await response).finished(); await settle(page);
    }
    if (order === 'before-success') await releaseRead();
    releasePatch(); state.settingsGate = null;
    await expect(control).toBeEnabled();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    assert.equal(state.preferences[1], 'en');
    if (order !== 'before-success') await releaseRead();
    await expect(control).toHaveValue('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    // The protection must not pin the last local choice forever.
    state.preferences[1] = 'zh-CN';
    const fresh = page.waitForResponse(response => response.url().endsWith('/api/me/settings') && response.request().method() === 'GET');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await (await fresh).finished();
    await expect(control).toHaveValue('zh-CN');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    assert.deepEqual(errors, []);
    console.log(`PASS F2 ${order}: overlapping settings read ignored; later remote preference accepted`);
  } finally { await context.close(); }
}

try {
  if (!only || only === 'F1') await expiredExport();
  if (!only || only === 'F2') for (const order of ['after-success', 'before-success', 'during-write']) await staleSettings(order);
} finally { await browser.close(); }
