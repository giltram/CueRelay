import { test as base, expect } from 'playwright/test';

export const fixtures = JSON.parse(process.env.CUERELAY_REGRESSION_FIXTURES);
export const button = (scope, name) => scope.getByRole('button', { name, exact: true });
export const rows = page => page.locator('tbody tr[data-cue-id]');
export const text = page => page.getByRole('textbox', { name: '字幕中文文本', exact: true });
export const organizationPath = fixtures.projectPath?.split('/projects/')[0] ?? '';
export const listPath = `${organizationPath.slice(4)}/projects`;
export const settingsPath = fixtures.workspacePath?.replace(/workspace$/, 'settings') ?? '';

// All new scenarios fail on uncaught errors, including errors in sibling pages.
export const test = base.extend({
  browserErrors: [async ({ context }, use) => {
    const errors = [];
    const observe = page => page.on('pageerror', error => errors.push(String(error)));
    context.pages().forEach(observe);
    context.on('page', observe);
    await use();
    expect(errors).toEqual([]);
  }, { auto: true }],
});
export { expect };

export async function login(page, path = '/settings', username = fixtures.username, password = fixtures.password) {
  await page.goto(path);
  await page.getByLabel('用户名', { exact: true }).fill(username);
  await page.getByLabel('密码', { exact: true }).fill(password);
  const response = page.waitForResponse(r => r.url().endsWith('/api/auth/login') && r.request().method() === 'POST');
  await button(page, '登录').click();
  expect((await response).status()).toBe(200);
}

export async function request(context, path, method = 'GET', data) {
  const token = (await context.cookies()).find(cookie => cookie.name === 'csrftoken')?.value;
  return context.request.fetch(path, { method, data, headers: token ? { 'X-CSRFToken': token } : {} });
}

export async function readProject(page, path = fixtures.projectPath) {
  const response = await page.request.get(path);
  expect(response.status()).toBe(200);
  return (await response.json()).project;
}

export async function verifyVideo(page) {
  await page.getByLabel('导入本地视频', { exact: true }).setInputFiles(fixtures.video);
  await button(page, '选择第 1 行').click();
  await expect(text(page)).toBeEditable();
}

export async function openWorkspace(page) {
  await login(page, fixtures.workspacePath);
  await verifyVideo(page);
}

export async function saveDocument(page, revision) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === `${fixtures.projectPath}/document`
    && r.request().method() === 'PUT');
  await button(page, '保存项目').click();
  const result = await response;
  expect(result.request().postDataJSON().revision).toBe(revision);
  expect(result.status()).toBe(200);
  await expect(button(page, '保存项目')).toBeDisabled();
  const stored = await readProject(page);
  expect(stored.revision).toBe(revision + 1);
  expect(stored.document).toEqual(result.request().postDataJSON().document);
  return stored;
}

export async function menu(page, row, label) {
  await row.click({ button: 'right' });
  await page.getByRole('menuitem', { name: label }).click();
}
