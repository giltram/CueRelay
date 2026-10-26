// Real DOM + deferred HTTP responses; no development database writes.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import defaults from '../../shared/timing-shortcuts.json' with { type: 'json' };

const baseURL = process.env.PERSONAL_SETTINGS_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ baseURL });
context.setDefaultTimeout(10000);
const errors = [], unexpected = [];
let settings = { shortcut_overrides: {}, audio_display_mode: 'spectrum', mouse_sets_cue_boundary: true, defaults };
let observePatch;
await context.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  if (path === '/api/me/settings') {
    if (request.method() === 'PATCH') {
      const completion = Promise.withResolvers();
      const body = request.postDataJSON();
      observePatch({ body, finish: completion.resolve });
      if (!await completion.promise) {
        return route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: '测试保存失败' } } });
      }
      settings = { ...settings, ...body };
    }
    return route.fulfill({ json: settings });
  }
  const fixtures = {
    '/api/auth/session': { user: { id: 1, username: 'pending-fixture', is_dev: false } },
    '/api/organizations': { organizations: [] },
  };
  if (request.method() === 'GET' && fixtures[path]) return route.fulfill({ json: fixtures[path] });
  unexpected.push(`${request.method()} ${path}`);
  return route.abort();
});

try {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto('/settings');
  const binding = page.getByLabel('提交并下一条绑定', { exact: true });
  const row = page.locator('.shortcut-row').filter({ has: binding });
  const recorder = page.getByLabel('录制快捷键', { exact: true });
  const save = page.getByRole('button', { name: '保存快捷键', exact: true });
  const allDefaults = page.getByRole('button', { name: '全部恢复默认', exact: true });
  const mouse = page.getByLabel('鼠标点击设置字幕边界', { exact: true });
  const status = page.getByRole('status');
  const beginSave = async () => {
    const observed = Promise.withResolvers();
    observePatch = observed.resolve;
    await save.click();
    return observed.promise;
  };
  const checkPending = async expected => {
    await page.waitForFunction(() => document.querySelectorAll('.shortcut-row input:disabled').length > 0);
    for (const control of await page.locator('.shortcut-row input, .shortcut-row button').all()) {
      assert(await control.isDisabled());
    }
    for (const control of [recorder, allDefaults, mouse, save]) assert(await control.isDisabled());
    assert.equal(await status.count(), 0);
    // Native disabled buttons ignore click(), including single/all restores.
    await page.locator('.shortcut-row button').evaluateAll(buttons => buttons.forEach(button => button.click()));
    await allDefaults.evaluate(button => button.click());
    await binding.evaluate(input => input.focus());
    await page.keyboard.type('Shift+KeyY');
    assert.equal(await binding.inputValue(), expected);
  };

  await binding.fill('Shift+KeyT');
  await row.getByRole('button', { name: '录制', exact: true }).click();
  const first = await beginSave();
  assert.deepEqual(first.body.shortcut_overrides, { commit: ['Shift+KeyT'] });
  await checkPending('Shift+KeyT');
  first.finish(true);
  await page.getByText('已保存', { exact: true }).waitFor();
  assert.equal(await binding.inputValue(), 'Shift+KeyT');
  assert(await binding.isEnabled());
  assert(await recorder.isEnabled());

  // Failed saves preserve exactly the submitted draft and permit editing again.
  await binding.fill('Shift+KeyY');
  await mouse.uncheck();
  const second = await beginSave();
  assert.deepEqual(second.body.shortcut_overrides, { commit: ['Shift+KeyY'] });
  assert.equal(second.body.mouse_sets_cue_boundary, false);
  await checkPending('Shift+KeyY');
  second.finish(false);
  await page.getByText('测试保存失败', { exact: true }).waitFor();
  assert.equal(await binding.inputValue(), 'Shift+KeyY');
  assert.equal(await mouse.isChecked(), false);
  assert(await binding.isEnabled());
  assert(await allDefaults.isEnabled());
  assert(await recorder.isEnabled());
  await recorder.press('Shift+KeyZ');
  assert.equal(await binding.inputValue(), 'Shift+KeyZ');
  await row.getByRole('button', { name: '恢复默认', exact: true }).click();
  assert.equal(await binding.inputValue(), defaults.commit.bindings.join(', '));
  await allDefaults.click();
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected, []);
  console.log(JSON.stringify({ browser: browser.version(), pendingControlsDisabled: true,
    submittedVersionConfirmed: true, failedDraftPreserved: true, editingRestored: true, errors, unexpected }, null, 2));
} finally {
  await browser.close();
}
