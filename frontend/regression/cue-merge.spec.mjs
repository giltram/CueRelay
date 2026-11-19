import { readFile } from 'node:fs/promises';
import { test, expect } from 'playwright/test';
import { sameTab } from '../browser-tests/link-navigation.mjs';

const fixtures = JSON.parse(process.env.CUERELAY_REGRESSION_FIXTURES);
const button = (page, name) => page.getByRole('button', { name, exact: true });
const textbox = (page, name) => page.getByRole('textbox', { name, exact: true });
const rows = page => page.locator('tbody tr[data-cue-id]');
const selectedRows = page => rows(page).and(page.locator('[aria-selected="true"]'));
const rowButton = (page, index) => rows(page).nth(index).locator('.row-number');
const ids = locator => locator.evaluateAll(elements => elements.map(row => row.dataset.cueId));
const workspace = page => page.locator('main.editor-workbench');
const isExport = response => response.url().endsWith('/api/ass/export');

async function signIn(page, path, english = false) {
  await page.goto(path);
  await page.getByLabel(english ? 'Username' : '用户名', { exact: true }).fill(fixtures.username);
  await page.getByLabel(english ? 'Password' : '密码', { exact: true }).fill(fixtures.password);
  await button(page, english ? 'Sign in' : '登录').click();
}

async function history(page, redo = false) {
  await workspace(page).focus();
  await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
}

async function focusRow(page, index) {
  const row = rowButton(page, index);
  await row.scrollIntoViewIfNeeded();
  await row.focus();
  // Let the scroll events from moving focus reach the viewport before opening a menu that dismisses on scroll.
  await row.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return row;
}

async function openKeyboardMenu(page, index) {
  await focusRow(page, index);
  await page.keyboard.press('Shift+F10');
}

test('workspace merge project preserves ASS metadata and integrates with preview, QC, search and explicit save', async ({ page }) => {
  const command = page.getByRole('menuitem', { name: '合并字幕行', exact: true });
  const save = button(page, '保存项目');
  const searchStatus = page.locator('.cue-search-status');
  const savedProject = async () => {
    const response = await page.request.get(fixtures.projectPath);
    expect(response.ok()).toBe(true);
    return (await response.json()).project;
  };

  await signIn(page, fixtures.workspacePath);
  await expect(rows(page)).toHaveCount(4);
  const originalIds = await ids(rows(page));
  const [earliestId, otherId, survivorId, lastId] = originalIds;
  await rowButton(page, 2).click();
  await rowButton(page, 0).click({ modifiers: ['ControlOrMeta'] });
  await rowButton(page, 0).click({ button: 'right' });
  await expect(command).toBeDisabled();
  await page.keyboard.press('Escape');
  const videoInput = page.getByLabel('导入本地视频', { exact: true });
  await videoInput.setInputFiles(fixtures.video);
  await expect(page.locator('.ass-preview-status')).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('.audio-timeline')).toHaveAttribute('data-state', 'ready');
  const baseline = await savedProject();
  const video = await page.locator('video').elementHandle();
  const canvas = await page.locator('.ass-preview-canvas').elementHandle();
  const workers = page.workers();

  await button(page, '查找字幕').click();
  await textbox(page, '查找字幕文本').fill('甲乙');
  await expect(searchStatus).toHaveText(/2 处 · 2 行/);
  const qc = page.waitForResponse(response => response.url().endsWith('/api/ass/inspect') && response.ok());
  await button(page, '字幕质量检查').click();
  await qc;
  await expect(page.locator('.qc-status')).not.toHaveText('正在检查…');

  await expect.poll(() => ids(selectedRows(page))).toEqual([earliestId, survivorId]);
  await expect(rowButton(page, 0)).toHaveAttribute('aria-pressed', 'true');
  await video.evaluate(element => { element.currentTime = 4; });
  await expect.poll(() => video.evaluate(element => element.seeking)).toBe(false);
  const stage = page.locator('.video-stage');
  const originalFrame = await stage.screenshot();

  const { cues: [first, other, , last] } = baseline.document;
  const merged = { ...first, end_ms: 5000, text: '{\\i1}甲乙\\N继续 甲乙' };
  const expected = { ...baseline.document, cues: [merged, other, last] };
  const conversions = [];
  page.on('response', response => {
    if (isExport(response) && response.request().postDataJSON()?.document.cues[0].text === merged.text) conversions.push(response);
  });
  await rowButton(page, 0).click({ button: 'right' });
  await expect(command).toBeEnabled();
  await command.click();
  await expect.poll(() => ids(rows(page))).toEqual([otherId, survivorId, lastId]);
  await expect.poll(() => ids(selectedRows(page))).toEqual([survivorId]);
  await expect(rowButton(page, 1)).toHaveAttribute('aria-pressed', 'true');
  await expect(textbox(page, '字幕中文文本')).toHaveValue(merged.text);
  await expect(searchStatus).toHaveText(/2 处 · 1 行/);
  await expect(page.getByText('字幕已修改，待重新检查。', { exact: true })).toBeVisible();
  await expect.poll(() => conversions.length).toBeGreaterThanOrEqual(2);
  expect(conversions.every(response => response.ok())).toBe(true);
  await expect.poll(async () => (await stage.screenshot()).equals(originalFrame)).toBe(false);
  const source = await conversions[1].text();
  expect(source.split('\n').filter(line => /^(Dialogue|Comment):/.test(line))).toEqual([
    `Dialogue: 4,0:00:03.00,0:00:05.00,Emphasis,合并说话人,0011,0022,0033,,${merged.text}`,
    'Comment: 0,0:00:02.00,0:00:02.50,Default,备注,0000,0000,0000,,保留注释',
    'Dialogue: 0,0:00:01.00,0:00:02.00,Default,乙,0004,0005,0006,,保留',
    'Dialogue: 0,0:00:07.00,0:00:08.00,Default,,0000,0000,0000,,尾句',
  ]);
  const imported = await page.request.post('/api/ass/import', { data: { source } });
  expect(imported.ok()).toBe(true);
  const { document: roundTrip } = await imported.json();
  expect(roundTrip.cues.map(cue => [cue.start_ms, cue.end_ms, cue.text, roundTrip.styles.find(style => style.id === cue.style_id).name]))
    .toEqual([[3000, 5000, merged.text, 'Emphasis'], [1000, 2000, '保留', 'Default'], [7000, 8000, '尾句', 'Default']]);
  expect(await video.evaluate(element => ({ same: element === document.querySelector('video'), time: element.currentTime, paused: element.paused })))
    .toEqual({ same: true, time: 4, paused: true });
  expect(await canvas.evaluate(element => element === document.querySelector('.ass-preview-canvas'))).toBe(true);
  expect(workers.length).toBeGreaterThanOrEqual(2);
  expect(page.workers()).toEqual(workers);

  const restored = page.waitForResponse(response => isExport(response) && response.request().postDataJSON()?.document.cues.length === 4);
  await history(page);
  await expect.poll(() => ids(rows(page))).toEqual(originalIds);
  await expect.poll(() => ids(selectedRows(page))).toEqual([earliestId, survivorId]);
  await expect(rowButton(page, 0)).toHaveAttribute('aria-pressed', 'true');
  await expect(textbox(page, '入点')).toHaveValue('0:00:00.00');
  expect((await restored).request().postDataJSON().document).toEqual(baseline.document);
  await history(page, true);
  await expect.poll(() => ids(selectedRows(page))).toEqual([survivorId]);
  await expect(textbox(page, '入点')).toHaveValue('0:00:03.00');
  await expect(save).toBeEnabled();
  expect(await savedProject()).toEqual(baseline);

  await expect(page.getByText('本地草稿已保存。', { exact: true })).toBeVisible();
  await page.reload();
  await expect.poll(() => ids(rows(page))).toEqual(originalIds);
  await button(page, '恢复草稿').click();
  await expect.poll(() => ids(rows(page))).toEqual([otherId, survivorId, lastId]);
  await videoInput.setInputFiles(fixtures.video);
  await expect(save).toBeEnabled();
  const saving = page.waitForResponse(response => response.url().endsWith(`${fixtures.projectPath}/document`) && response.request().method() === 'PUT');
  await save.click();
  const saved = await saving;
  expect(saved.ok()).toBe(true);
  expect(saved.request().postDataJSON().revision).toBe(baseline.revision);
  expect(await savedProject()).toMatchObject({ revision: baseline.revision + 1, document: expected });
  await page.reload();
  await expect.poll(() => ids(rows(page))).toEqual([otherId, survivorId, lastId]);
  await expect(button(page, '恢复草稿')).toHaveCount(0);

  await page.goto(fixtures.archivedWorkspacePath);
  await expect(rows(page)).toHaveCount(4);
  await rowButton(page, 0).click();
  await rowButton(page, 2).click({ modifiers: ['ControlOrMeta'] });
  await rowButton(page, 2).click({ button: 'right' });
  await expect(selectedRows(page)).toHaveCount(2);
  await expect(command).toBeDisabled();
});

test.describe('English narrow workspace', () => {
  test.use({ locale: 'en-US', viewport: { width: 360, height: 740 } });

  test('workspace merge local protects timing drafts and rejects invalid or abandoned transactions atomically', async ({ page }) => {
    const command = page.getByRole('menuitem', { name: 'Merge subtitle lines', exact: true });
    const menu = page.getByRole('menu', { name: 'Subtitle line commands' });
    const editor = textbox(page, 'Subtitle text input');
    const start = textbox(page, 'Start');
    await signIn(page, '/workspace/local', true);
    const header = (await readFile(fixtures.subtitles, 'utf8')).split('Dialogue:')[0];
    const source = `${header}Dialogue: 2,0:00:03.00,0:00:04.00,Emphasis,Actor,0010,0020,0030,,Late\n`
      + 'Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0000,0000,0000,,Early\n'
      + 'Dialogue: 0,0:00:02.00,0:00:02.00,Default,,0000,0000,0000,,Separate\n';
    await page.getByLabel('Import basic ASS', { exact: true }).setInputFiles({ name: 'merge.ass', mimeType: 'text/plain', buffer: Buffer.from(source) });
    await expect(rows(page)).toHaveCount(3);
    const originalIds = await ids(rows(page));
    const [earlyId, separateId, lateId] = originalIds;

    await openKeyboardMenu(page, 0);
    await expect(command).toBeDisabled();
    await page.keyboard.press('Escape');
    await rowButton(page, 2).click({ modifiers: ['ControlOrMeta'] });
    await expect.poll(() => ids(selectedRows(page))).toEqual([earlyId, lateId]);
    await start.fill('0:unfinished');
    await openKeyboardMenu(page, 1);
    await expect(command).toBeDisabled();
    await page.keyboard.press('Escape');
    await openKeyboardMenu(page, 0);
    await expect(command).toBeEnabled();
    expect(await menu.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight
        && element.scrollWidth <= element.clientWidth;
    })).toBe(true);
    await command.press('Enter');
    await expect(page.getByRole('alert')).toHaveText('Apply your time draft or restore the original start and end times first.');
    await expect(start).toHaveValue('0:unfinished');
    await expect(editor).toHaveValue('Late');
    await expect(workspace(page)).toBeFocused();
    await history(page);
    await expect(start).toHaveValue('0:00:03.00');

    const maximumText = 'x'.repeat(16_384);
    await editor.fill(maximumText);
    await openKeyboardMenu(page, 0);
    await expect(command).toBeEnabled();
    const rejected = page.waitForResponse(response => isExport(response) && response.status() === 422);
    await command.click();
    await rejected;
    await expect(page.getByRole('alert')).toContainText('16384');
    await expect(rows(page).last().locator('.cue-text')).toHaveText(maximumText);
    await expect.poll(() => ids(rows(page))).toEqual(originalIds);
    await expect.poll(() => ids(selectedRows(page))).toEqual([earlyId, lateId]);
    await history(page);
    await expect(editor).toHaveValue('Late');

    await openKeyboardMenu(page, 0);
    await menu.dispatchEvent('compositionstart');
    await command.press('Enter');
    await workspace(page).dispatchEvent('compositionend');
    await expect.poll(() => ids(rows(page))).toEqual(originalIds);

    const paused = Promise.withResolvers(), release = Promise.withResolvers();
    await page.route('**/api/ass/export', async route => {
      paused.resolve(route.request());
      await release.promise;
      await route.abort().catch(() => {});
    }, { times: 1 });
    await openKeyboardMenu(page, 0);
    await command.click();
    const request = await paused.promise;
    const canceled = page.waitForEvent('requestfailed', candidate => candidate === request);
    await sameTab(page.getByRole('link', { name: 'Settings', exact: true }));
    await expect(workspace(page)).toBeHidden();
    try { await canceled; } finally { release.resolve(); }
    await page.goBack();
    await expect.poll(() => ids(rows(page))).toEqual(originalIds);
    await expect.poll(() => ids(selectedRows(page))).toEqual([earlyId, lateId]);

    const firstRow = await focusRow(page, 0);
    const box = await firstRow.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' });
    await expect(command).toBeEnabled();
    const exported = page.waitForResponse(response => isExport(response) && response.ok());
    await command.click();
    await expect.poll(() => ids(rows(page))).toEqual([separateId, lateId]);
    await expect(editor).toHaveValue('Late Early');
    expect(await (await exported).text()).toContain('Dialogue: 2,0:00:03.00,0:00:04.00,Emphasis,Actor,0010,0020,0030,,Late Early');
    await history(page);
    await expect.poll(() => ids(selectedRows(page))).toEqual([earlyId, lateId]);
    await expect(editor).toHaveValue('Early');
    await history(page, true);
    await expect.poll(() => ids(selectedRows(page))).toEqual([lateId]);
    await expect(editor).toHaveValue('Late Early');
  });
});
