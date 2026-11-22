import { readFile } from 'node:fs/promises';
import { test, expect, fixtures, button, rows, text, login, verifyVideo, saveDocument, readProject, menu } from './helpers.mjs';

const first = '{\\an7\\pos(30,30)\\c&H0000FF&\\alpha&H80&\\b1}甲{\\r}乙';
const replaced = first.replace('甲', '新').replace('乙', '');
const merged = replaced + ' {\\c&H00FF00&}丙';
const history = async (page, redo = false) => {
  await page.locator('main.editor-workbench').focus();
  await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
};

async function download(page, format) {
  const event = page.waitForEvent('download');
  await button(page, `导出 ${format}`).click();
  if (format === 'SRT') {
    const panel = page.locator('.subtitle-qc-panel');
    await expect(panel.getByText(/透明文字会变为可见文字/)).toBeVisible();
    await button(panel, '继续导出 SRT').click();
  }
  const result = await event;
  expect(await result.failure()).toBeNull();
  return readFile(await result.path(), 'utf8');
}

test('ass static local import replacement merge and draft recovery', async ({ page }) => {
  await login(page, '/workspace/local');
  await page.getByLabel('导入 ASS / SRT 字幕', { exact: true }).setInputFiles(fixtures.staticSubtitles);
  await expect(rows(page)).toHaveCount(2);
  await button(page, '选择第 1 行').click();
  await expect(text(page)).toHaveValue(first);
  await button(page, '查找字幕').click();
  const query = page.getByRole('textbox', { name: '查找字幕文本', exact: true });
  await query.fill('0000FF');
  await expect(page.locator('.cue-search-status')).toHaveText('无匹配');
  await query.fill('甲乙');
  await expect(page.locator('.cue-search-status')).toHaveText(/1 处 · 1 行/);
  await button(page, '展开替换').click();
  await page.getByRole('textbox', { name: '替换文本', exact: true }).fill('新');
  await button(page, '全部替换').click();
  await expect(text(page)).toHaveValue(replaced);
  await history(page);
  await expect(text(page)).toHaveValue(first);
  await history(page, true);
  await expect(text(page)).toHaveValue(replaced);

  // Duplicate line-wide tags in a merge are rejected by the real serializer.
  await button(page, '选择第 2 行').click();
  await text(page).fill('{\\pos(100,100)}丙');
  await button(page, '选择第 1 行').click({ modifiers: ['ControlOrMeta'] });
  await menu(page, rows(page).first().locator('.row-number'), '合并字幕行');
  await expect(page.getByText(/每条字幕最多一个.*pos/)).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  await button(page, '选择第 2 行').click();
  await text(page).fill('{\\c&H00FF00&}丙');
  await button(page, '选择第 1 行').click({ modifiers: ['ControlOrMeta'] });
  await menu(page, rows(page).first().locator('.row-number'), '合并字幕行');
  await expect(rows(page)).toHaveCount(1);
  await expect(text(page)).toHaveValue(merged);
  await history(page);
  await expect(rows(page)).toHaveCount(2);
  await history(page, true);
  await expect(text(page)).toHaveValue(merged);
  await expect(page.getByText('本地草稿已保存。', { exact: true })).toBeVisible();
  await page.reload();
  await button(page, '恢复草稿').click();
  await expect(rows(page)).toHaveCount(1);
  await expect(text(page)).toHaveValue(merged);
  const output = await download(page, 'ASS');
  expect(output).toContain(`,0010,0020,0030,,${merged}`);
  const imported = await page.request.post('/api/ass/import', { data: { source: output } });
  expect(imported.status()).toBe(200);
  expect((await imported.json()).document.cues.map(cue => cue.text)).toEqual([merged]);
  const srt = await download(page, 'SRT');
  expect(srt).toContain('<b>新</b> 丙');
  expect(srt).not.toContain('\\');
});

test('ass static project preview save reload and format exports', async ({ page }) => {
  await login(page, fixtures.workspacePath);
  await verifyVideo(page);
  await expect(text(page)).toHaveValue(first);
  await expect(page.locator('.ass-preview-status')).toHaveAttribute('data-phase', 'ready');
  const stage = page.locator('.video-stage');
  const before = await stage.screenshot();
  const modified = first.replace('甲', '修改');
  const exported = page.waitForResponse(response => response.url().endsWith('/api/ass/export') && response.ok()
    && response.request().postDataJSON()?.document.cues[0].text === modified);
  await text(page).fill(modified);
  await exported;
  await expect.poll(async () => (await stage.screenshot()).equals(before)).toBe(false);
  await stage.screenshot({ path: `${test.info().outputDir}/static-preview.png` });
  const baseline = await readProject(page);
  const saved = await saveDocument(page, baseline.revision);
  expect(saved.document.cues[0].text).toBe(modified);
  await page.reload();
  await verifyVideo(page);
  await expect(text(page)).toHaveValue(modified);
  const ass = await download(page, 'ASS');
  expect(ass).toContain(modified);
  const imported = await page.request.post('/api/ass/import', { data: { source: ass } });
  expect(imported.status()).toBe(200);
  expect((await imported.json()).document.cues.map(cue => cue.text)).toEqual(saved.document.cues.map(cue => cue.text));
  const srt = await download(page, 'SRT');
  expect(srt).toContain('<b>修改</b>乙');
  expect(srt).not.toContain('\\');
});
