import { readFile } from 'node:fs/promises';
import { test, expect } from 'playwright/test';

const fixtures = JSON.parse(process.env.CUERELAY_REGRESSION_FIXTURES);
const button = (scope, name) => scope.getByRole('button', { name, exact: true });
const rows = page => page.locator('tbody tr[data-cue-id]');
const selected = page => rows(page).and(page.locator('[aria-selected="true"]'));
const source = '\ufeff9\r\n00:00:03,234 --> 00:00:04,235\r\n<b>晚句 &amp; 😀</b>\r\n第二行\r\n\r\n9\r\n00:00:01,231 --> 00:00:01,234\r\n早句';
const file = (name, text) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
const ids = locator => locator.evaluateAll(elements => elements.map(row => row.dataset.cueId));

async function login(page, path, english = false, organizer = false) {
  await page.goto(path);
  await page.getByLabel(english ? 'Username' : '用户名', { exact: true }).fill(organizer ? fixtures.organizer : fixtures.username);
  await page.getByLabel(english ? 'Password' : '密码', { exact: true }).fill(fixtures.password);
  await button(page, english ? 'Sign in' : '登录').click();
}

async function srtDownload(page, english = false) {
  await button(page, english ? 'Export SRT' : '导出 SRT').click();
  const panel = page.locator('.subtitle-qc-panel');
  await expect(panel.getByText(english ? /ASS fonts, colors/ : /不携带 ASS 字体/)).toBeVisible();
  const event = page.waitForEvent('download');
  await button(panel, english ? 'Continue exporting SRT' : '继续导出 SRT').click();
  const download = await event;
  expect(await download.failure()).toBeNull();
  return { name: download.suggestedFilename(), text: await readFile(await download.path(), 'utf8') };
}

async function assDownload(page) {
  await button(page, '导出 ASS').click();
  const event = page.waitForEvent('download');
  await button(page.locator('.subtitle-qc-panel'), '继续导出 ASS').click();
  const download = await event;
  return { name: download.suggestedFilename(), text: await readFile(await download.path(), 'utf8') };
}

test('srt local import failure preserves history selection timing and draft; downloads retain applied memory', async ({ page }) => {
  await login(page, '/workspace/local');
  const input = page.getByLabel('导入 ASS / SRT 字幕', { exact: true });
  const editor = page.getByRole('textbox', { name: '字幕中文文本', exact: true });
  const start = page.getByRole('textbox', { name: '入点', exact: true });
  await expect(input).toBeEnabled();
  await input.setInputFiles(file('中文.SRT', source));
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByText(/时间按最近 10ms 舍入/)).toBeVisible();
  await expect(rows(page).locator('.time-cell')).toHaveText(['0:00:01.23', '0:00:01.23', '0:00:03.23', '0:00:04.24']);
  await button(page, '选择第 1 行').click();
  await button(page, '选择第 2 行').click({ modifiers: ['ControlOrMeta'] });
  const selection = await ids(selected(page));
  expect(selection).toHaveLength(2);
  await editor.fill('当前未保存 & <tag> 中文😀');
  await start.fill('0:00:02.50');
  const beforeIds = await ids(rows(page));
  await input.setInputFiles(file('bad.srt', '1\n00:00:01,000 --> invalid\nx'));
  await button(page, '取消').click();
  await expect(start).toHaveValue('0:00:02.50');
  await input.setInputFiles(file('bad.srt', '1\n00:00:01,000 --> invalid\nx'));
  await button(page, '替换当前字幕').click();
  await expect(page.getByRole('alert')).toContainText('第 2 行：字幕块 1');
  await expect(editor).toHaveValue('当前未保存 & <tag> 中文😀');
  await expect(start).toHaveValue('0:00:02.50');
  expect(await ids(rows(page))).toEqual(beforeIds);
  expect(await ids(selected(page))).toEqual(selection);
  await page.locator('main.editor-workbench').focus();
  await page.keyboard.press('Control+z');
  await expect(start).toHaveValue('0:00:03.23');
  await page.keyboard.press('Control+Shift+z');
  await expect(start).toHaveValue('0:00:02.50');

  const exported = await srtDownload(page);
  expect(exported.name).toMatch(/^cuerelay_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.srt$/);
  expect(exported.text).toBe('1\n00:00:03,230 --> 00:00:04,240\n当前未保存 &amp; &lt;tag&gt; 中文😀\n\n2\n00:00:01,230 --> 00:00:01,230\n早句\n\n');
  await expect(start).toHaveValue('0:00:02.50');
  expect(await ids(rows(page))).toEqual(beforeIds);
  const reparsed = await page.request.post('/api/srt/import', { data: { source: exported.text } });
  expect(reparsed.ok()).toBe(true);
  expect((await reparsed.json()).document.cues[0]).toMatchObject({ start_ms: 3230, text: '当前未保存 & <tag> 中文😀' });
  const ass = await assDownload(page);
  expect(ass.name).toMatch(/\.ass$/);
  expect(ass.text).toContain('0:00:03.23,0:00:04.24');
  expect(ass.text).toContain('当前未保存 & <tag> 中文😀');

  // Selecting SRT must never change the existing leave-page ASS backup format.
  await page.getByRole('link', { name: 'CueRelay', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '离开工作区', exact: true });
  await expect(dialog).toBeVisible();
  const backupEvent = page.waitForEvent('download');
  await button(dialog, '导出 ASS').click();
  const backup = await backupEvent;
  expect(backup.suggestedFilename()).toMatch(/\.ass$/);
  await expect(dialog).toBeVisible();
  await button(dialog, '取消').click();
  await expect(page.getByText('本地草稿已保存。', { exact: true })).toBeVisible();
  await page.reload();
  await button(page, '恢复草稿').click();
  await expect(editor).toHaveValue('当前未保存 & <tag> 中文😀');
  await expect(start).toHaveValue('0:00:02.50');
  await page.screenshot({ path: test.info().outputPath('srt-local-zh.png') });

  // A successful replacement alone resets history, while failed replacement did not.
  await input.setInputFiles(file('replacement.srt', '1\n00:00:00,000 --> 00:00:02,000\n替换成功'));
  await button(page, '替换当前字幕').click();
  await expect(rows(page)).toHaveCount(1);
  await page.locator('main.editor-workbench').focus();
  await page.keyboard.press('Control+z');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText('替换成功');
});

test('srt project creation export explicit save reload and recovery use the existing document contract', async ({ page }) => {
  await login(page, '/projects', false, true);
  await button(page, '新建项目').click();
  const dialog = page.getByRole('dialog', { name: '新建项目', exact: true });
  await dialog.getByLabel('项目名称', { exact: true }).fill('SRT 导入测试');
  await dialog.getByLabel('基准视频', { exact: true }).setInputFiles(fixtures.video);
  await expect(dialog.getByText(/完整校验通过/)).toBeVisible();
  await dialog.getByLabel('选择 ASS / SRT 文件', { exact: true }).setInputFiles(file('bad.srt', 'unrecognized'));
  await expect(button(dialog, '创建并打开')).toBeDisabled();
  await dialog.getByLabel('更换 ASS / SRT 文件', { exact: true }).setInputFiles(file('initial.srt', source));
  await expect(dialog.getByText('initial.srt · 字幕预检通过', { exact: true })).toBeVisible();
  await button(dialog, '创建并打开').click();
  await expect(page).toHaveURL(/\/projects\/\d+\/workspace$/);
  const apiPath = '/api' + new URL(page.url()).pathname.replace(/\/workspace$/, '');
  const server = async () => (await (await page.request.get(apiPath)).json()).project;
  const baseline = await server();
  expect(baseline.document.script).toEqual({ play_res_x: 640, play_res_y: 360, scaled_border_and_shadow: true });
  expect(baseline.document.styles.map(style => style.name)).toEqual(['Default']);
  expect(baseline.document.source).toContain('[Script Info]');
  expect(baseline.document.source).not.toContain('-->');
  await expect(page.getByLabel('导入 ASS / SRT 字幕', { exact: true })).toHaveCount(0);
  const editor = page.getByRole('textbox', { name: '字幕中文文本', exact: true });
  await button(page, '选择第 2 行').click();
  await expect(editor).toBeEnabled();
  await expect(page.locator('.ass-preview-status')).toHaveAttribute('data-phase', 'ready');
  await editor.fill('项目未保存正文');
  await page.getByLabel('入点', { exact: true }).fill('0:');
  const snapshot = await srtDownload(page);
  expect(snapshot.name).toMatch(/^SRT 导入测试_.*\.srt$/);
  expect(snapshot.text).toContain('项目未保存正文');
  expect(await server()).toEqual(baseline);
  await expect(page.getByLabel('入点', { exact: true })).toHaveValue('0:');
  await expect(page.getByText('本地草稿已保存。', { exact: true })).toBeVisible();
  await page.reload();
  await button(page, '恢复草稿').click();
  await expect(editor).toHaveValue('项目未保存正文');
  await expect(page.getByLabel('入点', { exact: true })).toHaveValue('0:');
  await page.getByLabel('导入本地视频', { exact: true }).setInputFiles(fixtures.video);
  await expect(button(page, '保存项目')).toBeEnabled();
  await page.getByLabel('入点', { exact: true }).fill('0:00:03.23');
  const saving = page.waitForResponse(response => response.url().endsWith(`${apiPath}/document`) && response.request().method() === 'PUT');
  await button(page, '保存项目').click();
  expect((await saving).ok()).toBe(true);
  const saved = await server();
  expect(saved.revision).toBe(baseline.revision + 1);
  expect(saved.document.styles).toEqual(baseline.document.styles);
  expect(saved.document.script).toEqual(baseline.document.script);
  expect(saved.document.source).toEqual(baseline.document.source);
  expect(saved.document.cues[0].text).toBe('项目未保存正文');
  await page.reload();
  await expect(rows(page)).toContainText(['早句', '项目未保存正文']);
  await expect(button(page, '恢复草稿')).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('srt-project-zh.png') });
});

test.describe('English SRT on a narrow screen', () => {
  test.use({ locale: 'en-US', viewport: { width: 360, height: 740 } });
  test('srt english narrow keyboard IME and expired-session export remain usable', async ({ page, context }) => {
    await login(page, '/workspace/local', true);
    const input = page.getByLabel('Import ASS / SRT subtitles', { exact: true });
    await expect(input).toBeEnabled();
    await input.setInputFiles(file('sample.srt', '1\n00:00:01,234 --> 00:00:03,234\n<i>English 😀</i>'));
    await expect(rows(page)).toHaveCount(1);
    await button(page, 'Select line 1').click();
    const editor = page.getByRole('textbox', { name: 'Subtitle text input', exact: true });
    await editor.focus();
    await editor.dispatchEvent('compositionstart');
    await page.keyboard.press('Enter');
    await editor.dispatchEvent('compositionend');
    await expect(rows(page)).toHaveCount(1);
    await editor.fill('English & 中文 😀');
    const element = await editor.elementHandle();
    await context.clearCookies();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByText('Your session expired or the account changed. Subtitles, time inputs and video remain on this page. Please sign in again.')).toBeVisible();
    const exported = await srtDownload(page, true);
    expect(exported.text).toBe('1\n00:00:01,230 --> 00:00:03,230\nEnglish &amp; 中文 😀\n\n');
    expect(await element.evaluate(node => node === document.querySelector('.subtitle-input textarea'))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    const panel = page.locator('.subtitle-qc-panel');
    const continued = button(panel, 'Continue exporting SRT');
    await continued.focus();
    await expect(continued).toBeFocused();
    const box = await continued.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    const next = page.waitForEvent('download');
    await page.keyboard.press('Enter');
    await next;
    await page.screenshot({ path: test.info().outputPath('srt-english-narrow.png') });
  });
});
