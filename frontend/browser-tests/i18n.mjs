// Run against a dev Vite server. No application database; screenshots are review evidence, not approved baselines.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { installI18nFixtures, instrumentMedia } from './i18n-fixtures.mjs';
import { checkLayout, screenshotLayout, screenshotStyles } from './layout-checks.mjs';

const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-i18n-'));
console.log(`artifacts: ${artifacts}`);
const file = join(artifacts, 'video.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x180:r=10:d=8',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=8', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
const bytes = readFileSync(file), origin = process.env.I18N_URL || 'http://127.0.0.1:5238';
const browser = await chromium.launch({ headless: true });
const productLanguages = Object.keys(JSON.parse(readFileSync(new URL('../../shared/languages.json', import.meta.url), 'utf8')));
const acceptanceLanguages = [...productLanguages, 'en-XA'];
const reports = [];
const personalPath = '/organizations/1/settings/personal';
const workspacePath = '/organizations/1/projects/7/workspace';
const languageControl = page => page.locator('.settings-content .language-control select');
async function selectLanguage(page, language) {
  await languageControl(page).selectOption(language);
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await expect(languageControl(page)).toBeEnabled();
}
async function openPersonalInCurrentTab(page) {
  const settings = page.locator(`.app-header a[href="${personalPath}"]`);
  await settings.evaluate(link => { link.target = '_self'; });
  await settings.click();
  await expect(page).toHaveURL(origin + personalPath);
}
async function changeWorkspaceLanguage(page, language) {
  await openPersonalInCurrentTab(page);
  await selectLanguage(page, language);
  await page.goBack();
  await expect(page).toHaveURL(origin + workspacePath);
  await expect(page.locator('main.editor-workbench')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', language);
}
async function open(page, path, language) {
  await page.goto(origin + path);
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await expect(page.locator('.app-header .language-control')).toHaveCount(0);
  await expect(page.locator('.language-control')).toHaveCount(path === personalPath ? 1 : 0);
  await page.addStyleTag({ content: screenshotStyles });
  await page.evaluate(() => document.fonts.load('14px LayoutAcceptance'));
}
async function capture(page, name, controls, surfaces = []) {
  await checkLayout(page, { name, controls, surfaces });
  await screenshotLayout(page, join(artifacts, name + '.png'));
  reports.push(name);
}
try {
  for (const language of acceptanceLanguages) {
    const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 960 } });
    const { state, errors } = await installI18nFixtures(context, bytes);
    // Seed the rendered locale for direct-entry layout checks, including the dev-only pseudo locale.
    state.preferences[1] = language;
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    for (const width of [1440, 800]) {
      await page.setViewportSize({ width, height: 960 });
      await open(page, '/', language);
      await page.locator('.project-table tbody tr').waitFor();
      await capture(page, `${language}-${width}-projects`, [page.locator('.project-heading button'), page.locator('.project-table .button-link')], ['.project-table-scroll']);
      await page.locator('.project-table tbody tr button').first().click();
      await capture(page, `${language}-${width}-archive`, [page.locator('dialog .controls button').first(), page.locator('dialog .controls button').last()], ['dialog']);
      await page.keyboard.press('Escape');
      await page.locator('.project-heading button').click();
      await expect(page.locator('dialog')).toBeVisible();
      await capture(page, `${language}-${width}-create`, [page.locator('dialog .controls').last().getByRole('button').first(), page.locator('dialog .controls').last().getByRole('button').last()], ['dialog']);
      await page.keyboard.press('Escape');
      await open(page, personalPath, language);
      await page.locator('.shortcut-row').first().waitFor();
      await capture(page, `${language}-${width}-personal`, [languageControl(page), page.locator('.shortcut-row button').first(), page.locator('.shortcut-row button').nth(1), page.locator('.diagnostic-export button')], ['.settings-content']);
      const passwords = page.locator('input[type=password]');
      await passwords.nth(0).fill('incorrect'); await passwords.nth(1).fill('new-test-long-password-123!'); await passwords.nth(2).fill('new-test-long-password-123!');
      await passwords.nth(2).press('Enter');
      await expect(page.locator('.header-notices > [aria-label]').last()).toBeVisible();
      await open(page, '/organizations/1/settings/organization', language);
      await page.locator('.style-library-table tbody tr').waitFor();
      await capture(page, `${language}-${width}-organization`, [page.locator('.member-form button').first(), page.locator('.style-library-toolbar > button').last(), page.locator('.glossary-browser > button').last()], ['.settings-content']);
      await page.locator('.style-library-table button').first().click();
      await expect(page.locator('dialog')).toBeVisible();
      await capture(page, `${language}-${width}-template`, [page.locator('dialog form > .controls button').first(), page.locator('dialog form > .controls button').last()], ['dialog']);
      await page.keyboard.press('Escape');
      await open(page, '/organizations/1/projects/7/settings', language);
      await page.locator('.project-settings-form').waitFor();
      await capture(page, `${language}-${width}-project-settings`, [page.locator('.project-settings-form form button').first(), page.locator('.project-settings-form section button').first()], ['.project-settings-form']);
      await page.locator('.project-settings-form section button').first().click();
      await page.locator('dialog .style-manager').waitFor();
      await expect(page.locator('.style-sample figcaption')).not.toHaveText(/loading|加载/i);
      await capture(page, `${language}-${width}-styles`, [page.locator('dialog .style-list .controls button').first(), page.locator('dialog .style-detail .primary').first()], ['dialog']);
      await page.keyboard.press('Escape');
      await open(page, '/organizations/1/handbook', language);
      await page.locator('.handbook-content section').first().waitFor();
      await capture(page, `${language}-${width}-handbook`, [page.locator('.handbook-toc a').first()], ['.handbook-layout']);
    }
    await page.goto(origin + workspacePath);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    const transport = page.locator('.transport');
    await expect(transport).toBeVisible();
    for (const width of [1120, 1000, 390]) {
      await page.setViewportSize({ width, height: 680 });
      const { centered, fits } = await transport.evaluate(async element => {
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const bounds = element.getBoundingClientRect();
        const subtitles = element.querySelector('button[aria-pressed]').getBoundingClientRect();
        const stage = document.querySelector('.video-stage').getBoundingClientRect();
        const picker = document.querySelector('.video-stage .file-picker').getBoundingClientRect();
        return {
          centered: Math.abs(picker.left + picker.width / 2 - stage.left - stage.width / 2) < 1
            && Math.abs(picker.top + picker.height / 2 - stage.top - stage.height / 2) < 1,
          fits: subtitles.left >= bounds.left && subtitles.right <= bounds.right + 1
            && picker.left >= stage.left && picker.right <= stage.right,
        };
      });
      assert(centered && fits, `${language}-${width}: centered import and preview control fit their areas`);
    }
    reports.push(`${language}: import is centered in video and preview controls fit desktop/mobile`);
    assert.deepEqual(errors, [], `${language} browser errors`);
    await context.close();
  }

  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 960 } });
  await context.addInitScript(instrumentMedia);
  const { state, errors } = await installI18nFixtures(context, bytes);
  const page = await context.newPage(); page.setDefaultTimeout(20000);
  await open(page, workspacePath, 'zh-CN');
  await page.evaluate(async base64 => {
    const root = await navigator.storage.getDirectory(), handle = await root.getFileHandle('video.mp4', { create: true });
    const writer = await handle.createWritable(); await writer.write(Uint8Array.from(atob(base64), char => char.charCodeAt(0))); await writer.close();
  }, bytes.toString('base64'));
  await page.getByRole('button', { name: '导入视频', exact: true }).click();
  await expect(page.locator('.audio-timeline')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('.ass-preview-status')).toHaveAttribute('data-phase', 'ready');
  const first = page.locator('tr[data-cue-id="new-line-0"] .row-number');
  const second = page.locator('tr[data-cue-id="new-line-1"] .row-number');
  await first.click(); await second.click({ modifiers: ['Control'] });
  const text = page.locator('.subtitle-input textarea'), start = page.locator('.time-point input').first();
  await text.fill('未保存的文本草稿 Unsubmitted draft'); await start.fill('0:bad');
  const selection = await page.locator('tr[aria-selected=true]').evaluateAll(rows => rows.map(row => row.dataset.cueId));
  const active = await page.locator('.row-number[aria-pressed=true]').innerText();
  await page.evaluate(() => { window.__videoRef = document.querySelector('.video-stage video'); window.__canvasRef = document.querySelector('.video-stage canvas'); window.__videoSrc = window.__videoRef.src; });
  const instances = await page.evaluate(() => ({ ...window.__mediaCounts }));
  for (const language of ['en', 'en-XA', 'zh-CN']) {
    await changeWorkspaceLanguage(page, language);
    await expect(text).toHaveValue('未保存的文本草稿 Unsubmitted draft'); await expect(start).toHaveValue('0:bad');
    assert.deepEqual(await page.locator('tr[aria-selected=true]').evaluateAll(rows => rows.map(row => row.dataset.cueId)), selection);
    assert.equal(await page.locator('.row-number[aria-pressed=true]').innerText(), active);
    assert.deepEqual(await page.evaluate(() => ({ ...window.__mediaCounts })), instances, 'Language recreated media resources');
    assert(await page.evaluate(() => window.__videoRef === document.querySelector('.video-stage video') && window.__canvasRef === document.querySelector('.video-stage canvas') && window.__videoSrc === window.__videoRef.src));
    assert(await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('cuerelay-local-video', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const handles = await new Promise(resolve => { const request = db.transaction('handles').objectStore('handles').getAll(); request.onsuccess = () => resolve(request.result); }); db.close();
      return handles.length === 1 && await handles[0].isSameEntry(window.__pickedHandle);
    }), 'Local video handle changed');
  }
  // Preserve both history branches: undo, switch locale, redo restores the raw invalid draft.
  await page.locator('main.editor-workbench').focus(); await page.keyboard.press('Control+z'); await expect(start).not.toHaveValue('0:bad');
  await changeWorkspaceLanguage(page, 'en');
  await page.locator('main.editor-workbench').focus(); await page.keyboard.press('Control+Shift+z'); await expect(start).toHaveValue('0:bad');
  await expect(text).toHaveValue('未保存的文本草稿 Unsubmitted draft');
  await page.locator('[data-cue-qc][aria-expanded]').click();
  await expect(page.locator('.qc-issue').first()).toBeVisible();
  const inspected = state.inspections, issueTypes = await page.locator('.qc-issue').evaluateAll(items => items.map(item => item.dataset.qcType));
  await changeWorkspaceLanguage(page, 'zh-CN');
  assert.equal(state.inspections, inspected, 'Language reran QC');
  assert.deepEqual(await page.locator('.qc-issue').evaluateAll(items => items.map(item => item.dataset.qcType)), issueTypes);
  for (const language of acceptanceLanguages) {
    await changeWorkspaceLanguage(page, language);
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1120, height: 680 }, { width: 800, height: 960 }]) {
      await page.setViewportSize(viewport);
      await capture(page, `${language}-${viewport.width}-workspace-qc`, [page.locator('.qc-heading button').first(), page.locator('.file-actions button.primary').first()], ['.subtitle-qc-panel']);
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 }); await changeWorkspaceLanguage(page, 'en');
  await page.locator('[data-cue-qc][aria-expanded]').click();
  await page.locator('[data-glossary][aria-expanded]').click();
  await capture(page, 'en-workspace-glossary', [page.locator('.glossary-association button').first(), page.locator('.glossary-entries button').first()], ['.glossary-panel']);
  await page.locator('[data-glossary][aria-expanded]').click();
  await page.evaluate(() => { window.__clipboard = navigator.clipboard; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => 'Clipboard layout fixture' } }); });
  for (const language of acceptanceLanguages) {
    await changeWorkspaceLanguage(page, language);
    for (const viewport of [{ width: 1120, height: 680 }, { width: 800, height: 960 }]) {
      await page.setViewportSize(viewport);
      await page.locator('tr[data-cue-id="new-line-0"]').click({ button: 'right' });
      await capture(page, `${language}-${viewport.width}-line-menu`, [page.locator('[role=menu] button').first(), page.locator('[role=menu] button').last()], ['[role=menu]']);
      await expect(page.locator('[role=menu]')).toBeVisible();
      await page.keyboard.press('Escape');
      await page.locator('main.editor-workbench').focus(); await page.keyboard.press('Control+Shift+v');
      await page.locator('dialog .paste-fields').waitFor();
      await capture(page, `${language}-${viewport.width}-paste-over`, [page.locator('dialog .controls button').first(), page.locator('dialog .controls button').last()], ['dialog']);
      await page.keyboard.press('Escape');
    }
  }
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: window.__clipboard }));
  await page.setViewportSize({ width: 1440, height: 960 }); await changeWorkspaceLanguage(page, 'en');
  // Windowed list position survives changed header measurements.
  await page.locator('.table-scroll').evaluate(element => { element.scrollTop = 4000; });
  await page.waitForFunction(() => document.querySelector('.table-scroll').scrollTop > 3900);
  const anchor = async () => page.locator('.table-scroll').evaluate(async element => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const top = element.querySelector('thead').getBoundingClientRect().bottom;
    const row = [...element.querySelectorAll('tr[data-cue-id]')].find(row => row.getBoundingClientRect().bottom > top);
    return { id: row.dataset.cueId, inset: top - row.getBoundingClientRect().top };
  });
  const before = await anchor();
  await changeWorkspaceLanguage(page, 'zh-CN');
  await expect.poll(async () => (await anchor()).id).toBe(before.id);
  assert(Math.abs((await anchor()).inset - before.inset) < 2, 'Virtualized list lost its reading inset');
  reports.push('state: text, raw times, active row, multiselection, undo/redo, video/canvas, Workers/Object URLs, persisted handle, QC snapshot and windowed scroll');
  assert.deepEqual(errors, []);
  await context.close();

  const identity = await browser.newContext({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  const fixtures = await installI18nFixtures(identity, bytes), accountPage = await identity.newPage();
  fixtures.state.anonymous = true;
  await accountPage.goto(origin + '/'); await expect(accountPage.locator('html')).toHaveAttribute('lang', 'en');
  await expect(accountPage.locator('.login-page')).toBeVisible();
  await expect(accountPage.locator('.language-control')).toHaveCount(0);
  await accountPage.evaluate(() => localStorage.setItem('cuerelay.anonymous-language', 'zh-CN'));
  await accountPage.reload(); await expect(accountPage.locator('html')).toHaveAttribute('lang', 'zh-CN');
  fixtures.state.anonymous = false;
  await accountPage.goto(origin + personalPath);
  let release; fixtures.state.settingsGate = new Promise(resolve => { release = resolve; });
  await languageControl(accountPage).selectOption('en'); await expect(languageControl(accountPage)).toBeDisabled();
  fixtures.state.preferences[2] = 'zh-CN';
  fixtures.state.user = { id: 2, username: 'language-user-two', is_dev: false };
  await accountPage.evaluate(() => window.dispatchEvent(new Event('focus')));
  await accountPage.locator('dialog').waitFor(); await accountPage.locator('dialog .controls button').last().click();
  await expect(accountPage.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(accountPage.locator('.project-table')).toBeVisible();
  await openPersonalInCurrentTab(accountPage);
  release(); fixtures.state.settingsGate = null;
  await expect.poll(() => fixtures.state.preferences[1]).toBe('en');
  await expect(languageControl(accountPage)).toHaveValue('zh-CN'); await expect(languageControl(accountPage)).toBeEnabled();
  assert.equal(fixtures.state.preferences[2], 'zh-CN');
  reports.push('identity: browser/System fallback, legacy anonymous preference, account switch and delayed prior-account preference reply');
  await identity.close();
  writeFileSync(join(artifacts, 'results.json'), JSON.stringify({ screenshotsReviewed: false, reports }, null, 2));
  console.log(JSON.stringify({ artifacts, checks: reports.length }, null, 2));
} finally { await browser.close(); }
