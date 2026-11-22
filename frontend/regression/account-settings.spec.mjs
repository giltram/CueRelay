import { test, expect, fixtures, button, login, request } from './helpers.mjs';

const newPassword = 'changed-regression-password-928!';
const preference = page => page.request.get('/api/me/settings').then(r => r.json());

test('account login password session and logout lifecycle', async ({ page, browser, context }) => {
  await page.goto('/settings');
  await page.getByLabel('用户名', { exact: true }).fill(fixtures.username);
  await page.getByLabel('密码', { exact: true }).fill('wrong-password');
  await button(page, '登录').click();
  await expect(page.getByRole('alert')).toContainText('用户名或密码不正确');
  await expect(page.getByLabel('用户名', { exact: true })).toHaveValue(fixtures.username);
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('wrong-password');
  await page.getByLabel('密码', { exact: true }).fill(fixtures.password);
  await button(page, '登录').click();
  await expect(button(page, '退出账号')).toBeVisible();
  await page.reload();
  await expect(button(page, '退出账号')).toBeVisible();
  expect((await (await page.request.get('/api/auth/session')).json()).user.username).toBe(fixtures.username);

  // A separate real session must be invalidated by a password change.
  const sibling = await browser.newContext({ baseURL: 'http://127.0.0.1:5199' });
  try {
    await sibling.request.get('/api/auth/session');
    expect((await request(sibling, '/api/auth/login', 'POST', { username: fixtures.username, password: fixtures.password })).status()).toBe(200);
    const old = page.getByLabel('旧密码', { exact: true });
    const next = page.getByLabel('新密码', { exact: true });
    const confirmation = page.getByLabel('确认新密码', { exact: true });
    await old.fill('wrong-current-password'); await next.fill(newPassword); await confirmation.fill(newPassword);
    const failed = page.waitForResponse(r => r.url().endsWith('/api/auth/password'));
    await button(page, '修改密码').click();
    expect((await failed).status()).toBe(400);
    await expect(page.getByText('旧密码不正确。', { exact: true })).toBeVisible();
    await expect(old).toHaveValue('wrong-current-password');
    await expect(next).toHaveValue(newPassword); await expect(confirmation).toHaveValue(newPassword);
    await old.fill(fixtures.password);
    const changed = page.waitForResponse(r => r.url().endsWith('/api/auth/password'));
    await button(page, '修改密码').click();
    expect((await changed).status()).toBe(200);
    for (const input of [old, next, confirmation]) await expect(input).toHaveValue('');
    expect((await sibling.request.get('/api/auth/me')).status()).toBe(401);
    await page.reload();
    await expect(button(page, '退出账号')).toBeVisible();
    expect((await page.request.get('/api/auth/me')).status()).toBe(200);
    await button(page, '退出账号').click();
    await expect(button(page, '登录')).toBeVisible();
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
    await page.reload(); await expect(button(page, '登录')).toBeVisible();
    await page.getByLabel('用户名', { exact: true }).fill(fixtures.username);
    await page.getByLabel('密码', { exact: true }).fill(fixtures.password);
    await button(page, '登录').click();
    await expect(page.getByRole('alert')).toContainText('用户名或密码不正确');
    await page.getByLabel('密码', { exact: true }).fill(newPassword);
    const signedIn = page.waitForResponse(r => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST');
    await button(page, '登录').click();
    expect((await signedIn).status()).toBe(200);
    // Explicit logout returns to home; signing back in opens the project list.
    await expect(page.locator('.projects-page')).toBeVisible();
    await page.goto('/settings');
    await expect(button(page, '退出账号')).toBeVisible();
    expect((await (await request(context, '/api/auth/session')).json()).user.username).toBe(fixtures.username);
  } finally { await sibling.close(); }
});

test('account cooldown displays real retry contract and preserves credentials', async ({ page }) => {
  await page.goto('/settings');
  await page.getByLabel('用户名', { exact: true }).fill(fixtures.username);
  await page.getByLabel('密码', { exact: true }).fill('cooldown-wrong-password');
  for (let attempt = 1; attempt <= 5; attempt++) {
    const pending = page.waitForResponse(r => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST');
    await button(page, '登录').click();
    const response = await pending;
    expect(response.status()).toBe(attempt === 5 ? 429 : 401);
    if (attempt === 5) {
      const seconds = Number(response.headers()['retry-after']);
      expect(seconds).toBeGreaterThan(0); expect(seconds).toBeLessThanOrEqual(300);
      expect((await response.json()).error).toMatchObject({ code: 'rate_limited', params: { v0: seconds } });
      await expect(page.getByRole('alert')).toContainText(`请在 ${seconds} 秒后重试`);
    } else await expect(page.getByRole('alert')).toContainText('用户名或密码不正确');
  }
  await expect(page.getByLabel('用户名', { exact: true })).toHaveValue(fixtures.username);
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('cooldown-wrong-password');
  // There is no client countdown/disabled-until contract; only request busy.
  await expect(button(page, '登录')).toBeEnabled();
  await page.getByLabel('密码', { exact: true }).fill(fixtures.password);
  const locked = page.waitForResponse(r => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST');
  await button(page, '登录').click();
  expect((await locked).status()).toBe(429);
  expect((await (await page.request.get('/api/auth/session')).json()).user).toBeNull();
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue(fixtures.password);
});

test('account preferences persist restore and stay isolated after failed saves', async ({ page }) => {
  await login(page);
  const commit = page.getByLabel('提交并下一条绑定', { exact: true });
  const focus = page.getByLabel('字幕输入焦点切换', { exact: true });
  const mouse = page.getByRole('checkbox', { name: '鼠标点击设置字幕边界', exact: true });
  const audio = page.getByLabel('音频显示模式', { exact: true });
  await expect(commit).toBeVisible();
  const initial = await preference(page);
  await commit.fill('Shift+KeyT'); await focus.selectOption('Ctrl+Space'); await mouse.uncheck();
  await audio.selectOption('waveform');
  // Explicit transport fault only. Subsequent successful writes use Django unchanged.
  await page.route('**/api/me/settings', route => route.request().method() === 'PATCH' ? route.abort('failed') : route.continue(), { times: 1 });
  await button(page, '保存快捷键').click();
  await expect(page.getByLabel('个人设置反馈')).toHaveText('未收到服务器响应，操作结果未知；请重载确认后再重试。');
  await expect(commit).toHaveValue('Shift+KeyT'); await expect(focus).toHaveValue('Ctrl+Space'); await expect(mouse).not.toBeChecked();
  expect(await preference(page)).toEqual(initial);
  await expect(audio).toHaveValue('waveform');
  const shortcuts = page.waitForResponse(r => r.url().endsWith('/api/me/settings') && r.request().method() === 'PATCH');
  await button(page, '保存快捷键').click(); expect((await shortcuts).status()).toBe(200);
  const saved = await preference(page);
  expect(saved).toMatchObject({ mouse_sets_cue_boundary: false, shortcut_overrides: {
    commit: ['Shift+KeyT'], 'toggle-text-focus': ['Ctrl+Space'], 'split-text': ['Ctrl+KeyT'],
  } });
  await expect(audio).toHaveValue('waveform'); // Shortcut success preserves this independent unsaved draft.
  await page.route('**/api/me/settings', route => route.request().method() === 'PATCH' ? route.abort('failed') : route.continue(), { times: 1 });
  await button(page, '保存显示设置').click();
  await expect(page.getByLabel('个人设置反馈')).toHaveText('未收到服务器响应，操作结果未知；请重载确认后再重试。');
  await expect(audio).toHaveValue('waveform');
  expect(await preference(page)).toEqual(saved);
  const display = page.waitForResponse(r => r.url().endsWith('/api/me/settings') && r.request().method() === 'PATCH');
  await button(page, '保存显示设置').click();
  const response = await display;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON()).toEqual({ audio_display_mode: 'waveform' });
  expect((await preference(page)).shortcut_overrides).toEqual(saved.shortcut_overrides);
  await page.reload();
  await expect(commit).toHaveValue('Shift+KeyT'); await expect(focus).toHaveValue('Ctrl+Space');
  await expect(mouse).not.toBeChecked(); await expect(audio).toHaveValue('waveform');
  await button(page, '退出账号').click();
  await login(page, '/settings', fixtures.organizer);
  await expect(commit).toHaveValue('KeyG, Enter, NumpadEnter');
  await expect(focus).toHaveValue('Tab'); await expect(mouse).toBeChecked(); await expect(audio).toHaveValue('spectrum');
  expect((await preference(page)).shortcut_overrides).toEqual({});
  await button(page, '退出账号').click(); await login(page);
  await expect(commit).toHaveValue('Shift+KeyT'); await expect(audio).toHaveValue('waveform');
  await button(page, '全部恢复默认').click(); await mouse.check();
  const restored = page.waitForResponse(r => r.url().endsWith('/api/me/settings') && r.request().method() === 'PATCH');
  await button(page, '保存快捷键').click(); expect((await restored).status()).toBe(200);
  await audio.selectOption('spectrum');
  const resetAudio = page.waitForResponse(r => r.url().endsWith('/api/me/settings') && r.request().method() === 'PATCH');
  await button(page, '保存显示设置').click(); expect((await resetAudio).status()).toBe(200);
  await page.reload();
  await expect(commit).toHaveValue('KeyG, Enter, NumpadEnter'); await expect(focus).toHaveValue('Tab');
  await expect(mouse).toBeChecked(); await expect(audio).toHaveValue('spectrum');
  expect(await preference(page)).toEqual({ ...initial, shortcut_overrides: {}, mouse_sets_cue_boundary: true, audio_display_mode: 'spectrum' });
});
