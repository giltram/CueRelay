// Real App session races with isolated HTTP fixtures; no development database writes.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.SESSION_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext();
await context.addInitScript(() => Object.defineProperty(document, 'visibilityState', { get: () => 'visible' }));
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const user = { id: 1, username: 'fixture', is_dev: false };
let heldSession, heldLogin, holdSession = false, signedIn = true;
await context.route('**/api/**', route => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/api/auth/session') {
    if (holdSession) { holdSession = false; heldSession = route; return; }
    return route.fulfill({ json: { user: signedIn ? user : null } });
  }
  if (path === '/api/auth/login') { heldLogin = route; return; }
  const fixtures = {
    '/api/organizations': { organizations: [] },
    '/api/me/settings': { shortcut_overrides: {}, audio_display_mode: 'spectrum', mouse_sets_cue_boundary: true },
  };
  assert.ok(fixtures[path], `unexpected HTTP ${path}`);
  return route.fulfill({ json: fixtures[path] });
});
const waitFor = async predicate => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('expected request was not observed');
};
try {
  await page.goto(origin);
  await page.getByLabel('当前组织', { exact: true }).waitFor();
  holdSession = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => heldSession);
  const latest = page.waitForResponse(response => new URL(response.url()).pathname === '/api/me/settings');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await latest;
  await heldSession.fulfill({ json: { user } });
  // Allow the actual App catch and React render to run after the held response.
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.app-message').count(), 0);
  console.log('PASS overlapping focus and visibility observations stay silent');

  signedIn = false;
  await page.reload();
  await page.getByLabel('用户名', { exact: true }).fill('fixture');
  await page.getByLabel('密码', { exact: true }).fill('fixture-password');
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await waitFor(() => heldLogin);
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  signedIn = true;
  await heldLogin.fulfill({ json: { user } });
  await page.getByLabel('当前组织', { exact: true }).waitFor();
  assert.equal(await page.getByRole('alert').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS background session checks do not supersede an in-flight login');
} finally { await browser.close(); }
