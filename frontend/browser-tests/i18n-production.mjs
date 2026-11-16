import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
const origin = process.env.I18N_PRODUCTION_URL || 'http://127.0.0.1:5239';
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1280, height: 900 } });
  const errors = [], markdown = [];
  context.on('page', page => page.on('pageerror', error => errors.push(String(error))));
  context.on('request', request => { if (new URL(request.url()).pathname.endsWith('.md')) markdown.push(request.url()); });
  await context.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const values = {
      '/api/auth/session': { user: { id: 1, username: 'production-english', is_dev: false } },
      '/api/organizations': { organizations: [] },
      '/api/me/settings': { language_preference: 'en', handbook_seen: true, shortcut_overrides: {}, audio_display_mode: 'spectrum', mouse_sets_cue_boundary: true },
    };
    assert(values[path], `Unexpected API ${path}`); return route.fulfill({ json: values[path] });
  });
  const page = await context.newPage();
  await page.goto(origin + '/handbook');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('.handbook-title')).toHaveText('Handbook');
  await expect(page.locator('#first-cue h2')).toHaveText('Make your first subtitle');
  assert.equal(await page.locator('option[value="en-XA"]').count(), 0);
  assert.deepEqual(markdown, []);
  await page.goto(origin + '/open-source/index.en.html');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('h1')).toHaveText('CueRelay open-source licenses and source');
  assert.equal(await page.locator('a[href="sources/cuerelay-source.tar.gz"]').count(), 1);
  await page.goto(origin + '/open-source/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  assert.deepEqual(errors, []);
  console.log('PASS production: precompiled English handbook, stable IDs, no Markdown fetches, no pseudo option, bilingual license pages and unchanged source links');
} finally { await browser.close(); }
