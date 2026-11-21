import { readFile } from 'node:fs/promises';
import { test, expect } from 'playwright/test';

const fixtures = JSON.parse(process.env.CUERELAY_REGRESSION_FIXTURES);
const button = (page, name) => page.getByRole('button', { name, exact: true });
const textbox = (page, name) => page.getByRole('textbox', { name, exact: true });
const rows = page => page.locator('tbody tr[data-cue-id]');
const times = page => rows(page).locator('.time-cell');

test('workspace time shift project saves explicitly and restores a draft', async ({ page }) => {
  const title = '时间平移';
  const launch = button(page, title);
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  const apply = button(dialog, '应用平移');
  const save = button(page, '保存项目');
  const savedProject = async () => {
    const response = await page.request.get(fixtures.projectPath);
    expect(response.ok()).toBe(true);
    return (await response.json()).project;
  };
  await page.goto(fixtures.workspacePath);
  await page.getByLabel('用户名', { exact: true }).fill(fixtures.username);
  await page.getByLabel('密码', { exact: true }).fill(fixtures.password);
  await button(page, '登录').click();
  await expect(launch).toBeDisabled();
  await page.getByLabel('导入本地视频', { exact: true }).setInputFiles(fixtures.video);
  await expect(launch).toBeEnabled();
  await expect(page.locator('.ass-preview-status')).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('.audio-timeline')).toHaveAttribute('data-state', 'ready');
  const originalVideo = await page.locator('video').elementHandle();
  const originalCanvas = await page.locator('.ass-preview-canvas').elementHandle();
  const workers = page.workers();
  const initialTime = await originalVideo.evaluate(video => video.currentTime);
  const baseline = await savedProject();

  const qcResponse = page.waitForResponse(response => response.url().endsWith('/api/ass/inspect') && response.ok());
  await button(page, '字幕质量检查').click();
  await qcResponse;
  await expect(page.locator('.qc-status')).not.toHaveText('正在检查…');
  await launch.click();
  await expect(dialog.getByLabel('平移范围')).toHaveValue('selected');
  await expect(dialog.getByRole('status')).toHaveText('将平移 0 行');
  await dialog.getByLabel('时间偏移（毫秒）').fill('+7000');
  await expect(apply).toBeDisabled();
  await dialog.getByLabel('平移范围').selectOption('all');
  await expect(dialog.getByRole('status')).toHaveText('将平移 1 行');
  const preview = page.waitForResponse(response => response.url().endsWith('/api/ass/export')
    && response.request().postDataJSON()?.document.cues[0].start_ms === 7000);
  await apply.click();
  expect((await preview).ok()).toBe(true);
  await expect(times(page)).toHaveText(['0:00:07.00', '0:00:09.00']);
  await expect(rows(page).first()).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByText('字幕已修改，待重新检查。', { exact: true })).toBeVisible();
  await expect(page.getByText(/部分字幕超出视频时长/)).toBeVisible();
  await expect(save).toBeEnabled();
  expect(await originalVideo.evaluate(video => ({ same: video === document.querySelector('video'),
    paused: video.paused, time: video.currentTime }))).toEqual({ same: true, paused: true, time: initialTime });
  expect(await originalCanvas.evaluate(canvas => canvas === document.querySelector('.ass-preview-canvas'))).toBe(true);
  expect(workers.length).toBeGreaterThanOrEqual(2);
  expect(page.workers().length).toBe(workers.length);
  expect(page.workers().every(worker => workers.includes(worker))).toBe(true);
  expect(await savedProject()).toEqual(baseline);

  await expect(page.getByText('本地草稿已保存。', { exact: true })).toBeVisible();
  await page.reload();
  await expect(times(page)).toHaveText(['0:00:00.00', '0:00:02.00']);
  await button(page, '恢复草稿').click();
  await expect(times(page)).toHaveText(['0:00:07.00', '0:00:09.00']);
  await page.getByLabel('导入本地视频', { exact: true }).setInputFiles(fixtures.video);
  await expect(save).toBeEnabled();
  const response = page.waitForResponse(response => response.url().endsWith(`${fixtures.projectPath}/document`)
    && response.request().method() === 'PUT');
  await save.click();
  const saved = await response;
  expect(saved.status()).toBe(200);
  expect(saved.request().postDataJSON().revision).toBe(baseline.revision);
  await expect(save).toBeDisabled();
  const updated = await savedProject();
  expect(updated.revision).toBe(baseline.revision + 1);
  expect(updated.document).toEqual({ ...baseline.document,
    cues: [{ ...baseline.document.cues[0], start_ms: 7000, end_ms: 9000 }] });
  await page.reload();
  await expect(times(page)).toHaveText(['0:00:07.00', '0:00:09.00']);
  await expect(button(page, '恢复草稿')).toHaveCount(0);
});

test.describe('English local workspace', () => {
  test.use({ locale: 'en-US', viewport: { width: 360, height: 740 } });

  test('workspace time shift local retains selection, focus and history', async ({ page }) => {
    const title = 'Shift times';
    const launch = button(page, title);
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    const offset = textbox(dialog, 'Time offset (milliseconds)');
    const scope = dialog.getByLabel('Scope');
    const apply = button(dialog, 'Apply shift');
    const start = textbox(page, 'Start');
    const end = textbox(page, 'End');
    const active = textbox(page, 'Subtitle text input');
    const originalTimes = ['0:00:00.00', '0:00:01.00', '0:00:00.50', '0:00:00.50', '0:00:03.00', '0:00:04.00'];
    const shiftedTimes = ['0:00:03.00', '0:00:04.00', '0:00:03.50', '0:00:04.50', '0:00:04.00', '0:00:04.00'];

    await page.goto('/workspace/local');
    await page.getByLabel('Username', { exact: true }).fill(fixtures.username);
    await page.getByLabel('Password', { exact: true }).fill(fixtures.password);
    await button(page, 'Sign in').click();
    const template = await readFile(fixtures.subtitles, 'utf8');
    const source = template.slice(0, template.indexOf('Dialogue:')) + [
      'Dialogue: 2,0:00:03.00,0:00:04.00,Emphasis,Speaker,0010,0020,0030,,Late',
      'Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0000,0000,0000,,Early',
      'Dialogue: 0,0:00:00.50,0:00:00.50,Default,,0000,0000,0000,,Point',
    ].join('\n') + '\n';
    const importAss = page.getByLabel('Import ASS / SRT subtitles', { exact: true });
    await expect(importAss).toBeEnabled();
    await importAss.setInputFiles({ name: 'shift.ass', mimeType: 'text/plain', buffer: Buffer.from(source) });
    await expect(times(page)).toHaveText(originalTimes);
    await button(page, 'Select line 1').click();
    await button(page, 'Select line 2').click({ modifiers: ['ControlOrMeta'] });
    await expect(page.locator('tr[aria-selected="true"]')).toHaveCount(2);
    await expect(active).toHaveValue('Point');
    const [earlyId, pointId, lateId] = await rows(page).evaluateAll(elements => elements.map(row => row.dataset.cueId));

    await start.fill('0:unfinished');
    await launch.click();
    await offset.fill('+3500');
    await expect(apply).toBeDisabled();
    await expect(dialog.getByRole('alert')).toContainText('Apply your time draft');
    await offset.press('Enter');
    await expect(dialog).toBeVisible();
    await offset.press('Escape');
    await expect(launch).toBeFocused();
    await expect(start).toHaveValue('0:unfinished');
    await launch.press('Control+z');
    await expect(start).toHaveValue('0:00:00.50');

    await launch.press('Enter');
    await expect(offset).toBeFocused();
    expect(await dialog.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= innerWidth && element.scrollWidth <= element.clientWidth;
    })).toBe(true);
    await page.keyboard.press('Tab');
    await expect(scope).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(offset).toBeFocused();
    await expect(dialog.getByRole('status')).toHaveText('2 lines to shift');
    await scope.selectOption('all');
    await expect(dialog.getByRole('status')).toHaveText('3 lines to shift');
    await offset.fill('-510');
    await offset.press('Enter');
    await expect(dialog.getByRole('alert')).toContainText('outside 0:00:00.00 to 9:59:59.99');
    await offset.press('Escape');
    await expect(times(page)).toHaveText(originalTimes);

    await launch.click();
    await expect(scope).toHaveValue('selected');
    await offset.fill('+3501');
    await offset.press('Enter');
    await expect(dialog.getByRole('alert')).toContainText('multiple of 10 milliseconds');
    await offset.fill('+3500');
    await offset.dispatchEvent('compositionstart');
    await offset.press('Enter');
    await expect(dialog).toBeVisible();
    await offset.dispatchEvent('compositionend');
    await button(dialog, 'Cancel').press('g');
    await offset.press('Enter');
    await expect(launch).toBeFocused();
    await expect(times(page)).toHaveText(shiftedTimes);
    await expect(rows(page).nth(0)).toHaveAttribute('data-cue-id', lateId);
    await expect(rows(page).nth(1)).toHaveAttribute('data-cue-id', earlyId);
    await expect(rows(page).nth(2)).toHaveAttribute('data-cue-id', pointId);
    await expect(page.locator('tr[aria-selected="true"]')).toHaveCount(2);
    await expect(button(page, 'Select line 3')).toHaveAttribute('aria-pressed', 'true');
    await expect(active).toHaveValue('Point');
    await expect(start).toHaveValue('0:00:04.00');
    await expect(end).toHaveValue('0:00:04.00');

    await launch.press('Control+z');
    await expect(times(page)).toHaveText(originalTimes);
    await expect(button(page, 'Select line 2')).toHaveAttribute('aria-pressed', 'true');
    await expect(start).toHaveValue('0:00:00.50');
    await expect(end).toHaveValue('0:00:00.50');
    await launch.click();
    await offset.fill('0');
    await offset.press('Enter');
    await expect(launch).toBeFocused();
    await expect(times(page)).toHaveText(originalTimes);
    await launch.press('Control+Shift+z');
    await expect(times(page)).toHaveText(shiftedTimes);
    await expect(button(page, 'Select line 3')).toHaveAttribute('aria-pressed', 'true');
    await expect(start).toHaveValue('0:00:04.00');
    await expect(end).toHaveValue('0:00:04.00');

    await expect(page.getByText('Local draft saved.', { exact: true })).toBeVisible();
    await page.reload();
    await button(page, 'Restore draft').click();
    await expect(times(page)).toHaveText(shiftedTimes);
    await expect(rows(page).nth(2)).toHaveAttribute('data-cue-id', pointId);
  });
});
