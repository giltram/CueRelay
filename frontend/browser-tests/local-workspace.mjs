/** Enter the authenticated app's local editor with disposable browser credentials. */
export async function enterLocalWorkspace(page) {
  const local = page.getByRole('link', { name: '本地工作区', exact: true });
  const login = page.getByRole('button', { name: '登录', exact: true });
  const video = page.locator('video');
  await local.or(login).or(video).waitFor();
  if (await login.isVisible()) {
    if (!process.env.BROWSER_TEST_PASSWORD) throw new Error('Set BROWSER_TEST_PASSWORD for the disposable browser database');
    await page.getByLabel('用户名', { exact: true }).fill(process.env.BROWSER_TEST_USERNAME || 'project-empty');
    await page.getByLabel('密码', { exact: true }).fill(process.env.BROWSER_TEST_PASSWORD);
    await login.click();
  }
  await local.or(video).waitFor();
  if (await local.isVisible()) await local.click();
  await page.waitForFunction(() => document.querySelector('.file-actions button.primary')?.disabled === false);
}

export async function openLocalWorkspace(page, url) {
  await page.goto(url);
  await enterLocalWorkspace(page);
}
