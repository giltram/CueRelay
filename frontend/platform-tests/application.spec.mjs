import { runPlatformFlow } from './application-flow.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { test, expect, login } from '../regression/helpers.mjs';

const output = (testInfo, name, value) => writeFile(testInfo.outputPath(name), JSON.stringify(value, null, 2));

test('platform account handbook editing save and media capability', async ({ page, browser }, info) => {
  await runPlatformFlow(page, browser, value => output(info, 'capabilities.json', value));
});

test('production handbook licenses and source archive downloads', async ({ page, context, browser }, info) => {
  const markdown = []; context.on('request', req => { if (new URL(req.url()).pathname.endsWith('.md')) markdown.push(req.url()); });
  await login(page, '/handbook');
  const article = page.getByRole('article', { name: 'CueRelay 使用手册' });
  await expect(article).toBeVisible();
  for (const link of await page.getByRole('navigation', { name: '手册目录' }).getByRole('link').all()) {
    const href = await link.getAttribute('href');
    await link.click(); await expect(page.locator(href)).toBeVisible();
  }
  const license = article.locator('a[href="/open-source/"]');
  await expect(license).toBeVisible(); await license.click();
  await expect(page.locator('h1')).toContainText('许可');
  const source = page.locator('a[href="sources/cuerelay-source.tar.gz"]');
  await expect(source).toBeVisible();
  const download = page.waitForEvent('download'); await source.click();
  const file = await download; expect(await file.failure()).toBeNull();
  expect(file.suggestedFilename()).toBe('cuerelay-source.tar.gz');
  const bytes = await readFile(await file.path());
  expect(bytes[0]).toBe(0x1f); expect(bytes[1]).toBe(0x8b); expect(bytes.length).toBeGreaterThan(1000);
  const english = await page.request.get('/open-source/index.en.html'); expect(english.status()).toBe(200);
  expect(await english.text()).toContain('CueRelay open-source licenses and source');
  expect(markdown).toEqual([]);
  await output(info, 'production.json', { browser: browser.version(), archiveBytes: bytes.length, markdown });
});
