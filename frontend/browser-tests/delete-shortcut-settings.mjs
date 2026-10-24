// UI persistence fixtures; actual settings validation is covered by IdentityTests.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import defaults from '../../shared/timing-shortcuts.json' with { type: 'json' };

const baseURL = process.env.DELETE_SHORTCUT_URL || 'http://127.0.0.1:5173';
const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-delete-shortcut-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ baseURL, viewport: { width: 1360, height: 900 } });
const errors = [], unexpected = [];
let settings = { shortcut_overrides: {}, audio_display_mode: 'spectrum', defaults };
await context.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  if (path === '/api/me/settings') {
    if (request.method() === 'PATCH') settings = { ...settings, ...request.postDataJSON() };
    return route.fulfill({ json: settings });
  }
  const fixtures = {
    '/api/auth/session': { user: { id: 1, username: 'shortcut-fixture', is_dev: false } },
    '/api/organizations': { organizations: [] },
    '/api/ass/empty': { document: { source: '', styles: ['Default'], cues: [] } },
  };
  if (request.method() === 'GET' && fixtures[path]) return route.fulfill({ json: fixtures[path] });
  unexpected.push(`${request.method()} ${path}`); await route.abort();
});
context.on('page', page => {
  page.on('pageerror', error => errors.push(String(error)));
  page.on('dialog', dialog => dialog.dismiss());
});

try {
  const personal = await context.newPage();
  await personal.goto('/settings');
  const binding = personal.getByLabel('删除当前字幕行绑定', { exact: true });
  const row = personal.locator('.shortcut-row').filter({ has: binding });
  await binding.waitFor();
  assert.equal(await binding.inputValue(), defaults['delete-row'].bindings.join(', '));
  await personal.screenshot({ path: join(artifacts, 'settings-desktop.png'), fullPage: true });
  const save = async () => {
    await personal.getByRole('button', { name: '保存快捷键', exact: true }).click();
    await personal.getByText('已保存', { exact: true }).waitFor();
  };

  // Keep punctuation and spaces while typing; parse only when saving bindings.
  await binding.fill('');
  await binding.pressSequentially('Ctrl+Delete, ');
  assert.equal(await binding.inputValue(), 'Ctrl+Delete, ');
  await binding.pressSequentially('Meta+Delete, Ctrl+Backspace, Meta+Backspace');
  await save(); await personal.reload(); await binding.waitFor();
  assert.equal(await binding.inputValue(), defaults['delete-row'].bindings.join(', '));
  const commit = personal.getByLabel('提交并下一条绑定', { exact: true });
  await commit.fill(''); await commit.pressSequentially(' Shift+KeyT,  KeyT ');
  assert.equal(await commit.inputValue(), ' Shift+KeyT,  KeyT ');
  await save(); await personal.reload(); await binding.waitFor();
  assert.equal(await commit.inputValue(), 'Shift+KeyT, KeyT');
  const commitRow = personal.locator('.shortcut-row').filter({ has: commit });
  await commitRow.getByRole('button', { name: '恢复默认', exact: true }).click(); await save();

  // Recording accepts existing macOS and Ctrl deletion aliases.
  for (const [key, value] of [['Control+Delete', 'Ctrl+Delete'], ['Meta+Backspace', 'Meta+Backspace'], ['Shift+KeyX', 'Shift+KeyX']]) {
    await row.getByRole('button', { name: '录制', exact: true }).click();
    await personal.getByLabel('录制快捷键', { exact: true }).press(key);
    assert.equal(await binding.inputValue(), value);
  }
  await save(); await personal.reload(); await binding.waitFor();
  assert.equal(await binding.inputValue(), 'Shift+KeyX');

  const workspace = await context.newPage();
  await workspace.goto('/workspace/local');
  const rows = workspace.locator('.cue-list tbody tr');
  await rows.first().waitFor();
  const focus = () => workspace.locator('main').focus();
  const count = async n => { await workspace.waitForFunction(n => document.querySelectorAll('.cue-list tbody tr').length === n, n); };
  const createPair = async () => {
    await workspace.getByLabel('出点', { exact: true }).fill('0:00:02.00');
    await focus(); await workspace.keyboard.press('KeyG'); await count(2);
  };
  await focus();
  for (const key of ['Control+Delete', 'Meta+Delete', 'Control+Backspace', 'Meta+Backspace']) await workspace.keyboard.press(key);
  assert.equal(await rows.count(), 1);
  await workspace.getByLabel('字幕中文文本').focus();
  await workspace.keyboard.press('Shift+KeyX'); assert.equal(await rows.count(), 1);
  await focus(); await workspace.keyboard.press('Shift+KeyX'); await count(0);

  // Disable deletion, then restore all aliases using the existing settings controls.
  await binding.fill(''); await save();
  const disabled = workspace.waitForResponse(response => response.url().endsWith('/api/me/settings'));
  await workspace.evaluate(() => window.dispatchEvent(new Event('focus'))); await disabled;
  await createPair();
  for (const key of ['Shift+KeyX', 'Control+Delete', 'Meta+Delete', 'Control+Backspace', 'Meta+Backspace']) await workspace.keyboard.press(key);
  assert.equal(await rows.count(), 2);

  await row.getByRole('button', { name: '恢复默认', exact: true }).click();
  assert.equal(await binding.inputValue(), defaults['delete-row'].bindings.join(', '));
  await save();
  const refreshed = workspace.waitForResponse(response => response.url().endsWith('/api/me/settings'));
  await workspace.evaluate(() => window.dispatchEvent(new Event('focus'))); await refreshed;
  await focus();
  for (const key of ['Control+Delete', 'Meta+Delete', 'Control+Backspace', 'Meta+Backspace']) {
    if (await rows.count() === 0) await createPair();
    const before = await rows.count(); await workspace.keyboard.press(key); await count(before - 1);
  }
  await personal.reload(); await binding.waitFor();
  assert.equal(await binding.inputValue(), defaults['delete-row'].bindings.join(', '));
  await personal.setViewportSize({ width: 390, height: 844 });
  assert(await personal.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await personal.screenshot({ path: join(artifacts, 'settings-mobile.png'), fullPage: true });
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log(JSON.stringify({ browser: browser.version(), artifacts, commaDrafts: true, recording: true, reload: true,
    overrideReplacesDefaults: true, inputProtection: true, disabled: true, restored: true, errors, unexpected }, null, 2));
} finally { await browser.close(); }
