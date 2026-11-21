import { readFile } from 'node:fs/promises';
import { expect, test } from 'playwright/test';
import { sameTab } from '../browser-tests/link-navigation.mjs';

const fixtures = JSON.parse(process.env.CUERELAY_REGRESSION_FIXTURES);
const button = (page, name) => page.getByRole('button', { name, exact: true });
const textbox = (page, name) => page.getByRole('textbox', { name, exact: true });
const rows = page => page.locator('tbody tr[data-cue-id]');
const text = page => rows(page).locator('.cue-text');
const feedback = page => page.locator('.cue-replace-feedback');
const workspace = page => page.locator('main.editor-workbench');
const nativeUndo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

async function openWorkspace(page, path, english = false) {
  await page.goto(path);
  await page.getByLabel(english ? 'Username' : '用户名', { exact: true }).fill(fixtures.username);
  await page.getByLabel(english ? 'Password' : '密码', { exact: true }).fill(fixtures.password);
  await button(page, english ? 'Sign in' : '登录').click();
  await expect(rows(page).first()).toBeVisible();
}

async function workspaceHistory(page, redo = false) {
  await workspace(page).focus();
  await page.keyboard.press(redo ? 'Control+Shift+z' : 'Control+z');
}

async function delayExport(page) {
  const requested = Promise.withResolvers();
  const release = Promise.withResolvers();
  const finished = Promise.withResolvers();
  await page.route('**/api/ass/export', async route => {
    requested.resolve(route.request());
    await release.promise;
    try {
      await route.continue();
      finished.resolve();
    } catch (error) {
      finished.reject(error);
    }
  }, { times: 1 });
  return {
    requested: requested.promise,
    resume() {
      release.resolve();
      return finished.promise;
    },
  };
}

test('subtitle replace project verifies media, preserves timing, and saves a recovered draft explicitly', async ({ page }) => {
  const query = textbox(page, '查找字幕文本'), replacement = textbox(page, '替换文本');
  const show = button(page, '展开替换'), replace = button(page, '替换当前匹配'), all = button(page, '全部替换');
  const start = textbox(page, '入点'), save = button(page, '保存项目');
  const savedProject = async () => {
    const response = await page.request.get(fixtures.projectPath);
    expect(response.ok()).toBe(true);
    return (await response.json()).project;
  };
  await openWorkspace(page, fixtures.workspacePath);
  const baseline = await savedProject();
  await workspace(page).focus();
  await page.keyboard.press('Control+f');
  await query.fill('甲乙');
  await expect(show).toBeDisabled();
  await query.press('Enter');
  await expect(page.locator('.cue-search-status')).toHaveText('1 / 1 处 · 1 行');
  await page.getByLabel('导入本地视频', { exact: true }).setInputFiles(fixtures.video);
  await expect(show).toBeEnabled();
  await expect(page.locator('.ass-preview-status')).toHaveAttribute('data-phase', 'ready');
  await expect(page.locator('.audio-timeline')).toHaveAttribute('data-state', 'ready');

  const raw = '甲乙甲{\\b1}乙{\\b0}';
  await textbox(page, '字幕中文文本').fill(raw);
  await start.fill('0:');
  await query.press('Enter');
  await query.press('Enter');
  await expect(page.locator('mark.current-match')).toHaveText(['甲', '乙']);
  const inspected = page.waitForResponse(response => response.url().endsWith('/api/ass/inspect') && response.ok());
  await button(page, '字幕质量检查').click();
  await inspected;
  await expect(page.locator('.qc-status')).not.toHaveText('正在检查…');
  await show.click();
  await expect(replacement).toBeFocused();
  await replacement.fill('晚安🌙');

  const video = await page.locator('video').elementHandle();
  const canvas = await page.locator('.ass-preview-canvas').elementHandle();
  const workers = page.workers();
  await video.evaluate(video => { video.currentTime = 4; });
  await expect.poll(() => video.evaluate(video => video.seeking)).toBe(false);
  await replace.focus();
  await page.keyboard.press('Enter');
  await expect(feedback(page)).toHaveText('已替换 1 处。');
  await expect(text(page)).toHaveText('甲乙晚安🌙{\\b1}{\\b0}');
  await expect(replace).toBeFocused();
  await expect(start).toHaveValue('0:');
  await expect(replace).toBeDisabled();
  expect(await video.evaluate(video => ({ same: video === document.querySelector('video'), time: video.currentTime, paused: video.paused })))
    .toEqual({ same: true, time: 4, paused: true });
  expect(await canvas.evaluate(canvas => canvas === document.querySelector('.ass-preview-canvas'))).toBe(true);
  expect(workers.length).toBeGreaterThanOrEqual(2);
  expect(page.workers().length).toBe(workers.length);
  expect(page.workers().every(worker => workers.includes(worker))).toBe(true);
  await expect(page.getByText('字幕已修改，待重新检查。', { exact: true })).toBeVisible();
  expect(await savedProject()).toEqual(baseline);

  await workspaceHistory(page);
  await expect(text(page)).toHaveText(raw);
  await expect(start).toHaveValue('0:');
  await expect(rows(page)).toHaveAttribute('aria-selected', 'true');
  await workspaceHistory(page, true);
  await expect(text(page)).toHaveText('甲乙晚安🌙{\\b1}{\\b0}');
  await replacement.fill('早安');
  await replacement.press('Enter');
  await page.keyboard.insertText('🙂');
  await expect(replacement).toHaveValue('早安\n🙂');
  await all.click();
  const final = '早安\\N🙂晚安🌙{\\b1}{\\b0}';
  await expect(text(page)).toHaveText(final);
  await expect(start).toHaveValue('0:');
  await expect(save).toBeEnabled();
  await expect(page.getByText('本地草稿已保存。', { exact: true })).toBeVisible();
  expect(await savedProject()).toEqual(baseline);

  await page.reload();
  await expect(text(page)).toHaveText('甲乙');
  await button(page, '恢复草稿').click();
  await expect(text(page)).toHaveText(final);
  await expect(start).toHaveValue('0:');
  await page.getByLabel('导入本地视频', { exact: true }).setInputFiles(fixtures.video);
  await expect(save).toBeEnabled();
  const response = page.waitForResponse(response => response.url().endsWith(`${fixtures.projectPath}/document`) && response.request().method() === 'PUT');
  await save.click();
  const saved = await response;
  expect(saved.ok()).toBe(true);
  expect(saved.request().postDataJSON().revision).toBe(baseline.revision);
  const updated = await savedProject();
  expect(updated.revision).toBe(baseline.revision + 1);
  expect(updated.document).toEqual({ ...baseline.document, cues: [{ ...baseline.document.cues[0], text: final }] });
});

test.describe('English narrow workspace', () => {
  test.use({ locale: 'en-US', viewport: { width: 360, height: 740 } });

  test('subtitle replace local handles IME, native undo, batch history, and failed validation atomically', async ({ page, context }) => {
    const query = textbox(page, 'Find subtitle text'), replacement = textbox(page, 'Replacement text');
    const all = button(page, 'Replace all');
    const editor = textbox(page, 'Subtitle text input');
    await openWorkspace(page, '/workspace/local', true);
    const header = (await readFile(fixtures.subtitles, 'utf8')).split('Dialogue:')[0];
    const event = (start, end, body) => `Dialogue: 0,0:00:0${start}.00,0:00:0${end}.00,Default,Speaker,0010,0020,0030,,${body}\n`;
    await page.getByLabel('Import ASS / SRT subtitles', { exact: true }).setInputFiles({
      name: 'replace.ass', mimeType: 'text/plain', buffer: Buffer.from(header + event(0, 1, 'ababa ABA') + event(2, 3, 'ABA')),
    });
    await expect(rows(page)).toHaveCount(2);
    await workspace(page).focus();
    await page.keyboard.press('Meta+f');
    await query.fill('aba');
    await expect(page.locator('.cue-search-status')).toHaveText('0 / 4 matches · 2 lines');
    await query.press('Enter');
    await query.press('Enter');
    await expect(page.locator('.cue-search-status')).toHaveText('2 / 4 matches · 2 lines');
    await button(page, 'Show replacement').click();
    await expect(replacement).toBeFocused();
    expect(await page.locator('.cue-search-bar').evaluate(bar => bar.scrollWidth - bar.clientWidth)).toBeLessThanOrEqual(1);
    for (const control of [query, replacement, all, button(page, 'Replace current match')]) {
      const box = await control.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(360);
    }

    await page.keyboard.type('X');
    await page.keyboard.press(nativeUndo);
    await expect(replacement).toHaveValue('');
    await expect(text(page)).toHaveText(['ababa ABA', 'ABA']);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.imeSetComposition', { text: '早', selectionStart: 1, selectionEnd: 1 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229 });
    await cdp.send('Input.insertText', { text: '早安' });
    await cdp.detach();
    await expect(replacement).toHaveValue('早安');
    await expect(text(page)).toHaveText(['ababa ABA', 'ABA']);

    await replacement.fill('\\N');
    await all.click();
    await expect(feedback(page)).toHaveText('Replacement text cannot contain braces or backslashes.');
    await replacement.fill('x\ty');
    await all.click();
    await expect(feedback(page)).toContainText('Subtitle text must not contain control characters');
    await expect(text(page)).toHaveText(['ababa ABA', 'ABA']);
    await workspaceHistory(page);
    await expect(text(page)).toHaveText(['ababa ABA', 'ABA']);

    // A concurrent manual edit after validation starts supersedes the snapshot.
    const delayed = await delayExport(page);
    await replacement.fill('!');
    await all.click();
    await delayed.requested;
    await editor.fill('live ABA');
    await delayed.resume();
    await expect(feedback(page)).toContainText('Subtitles changed.');
    await expect(text(page)).toHaveText(['live ABA', 'ABA']);

    await page.getByRole('button', { name: 'Select line 2', exact: true }).click({ modifiers: ['ControlOrMeta'] });
    const start = textbox(page, 'Start');
    await start.fill('0:');
    await replacement.fill('aba!');
    await all.click();
    await expect(feedback(page)).toHaveText('Replaced 2 matches.');
    await expect(text(page)).toHaveText(['live aba!', 'aba!']);
    await expect(start).toHaveValue('0:');
    await expect(rows(page).first()).toHaveAttribute('aria-selected', 'true');
    await expect(rows(page).last()).toHaveAttribute('aria-selected', 'true');
    await workspaceHistory(page);
    await expect(text(page)).toHaveText(['live ABA', 'ABA']);
    await expect(start).toHaveValue('0:');
    await workspaceHistory(page, true);
    await expect(text(page)).toHaveText(['live aba!', 'aba!']);
    await expect(start).toHaveValue('0:');

    await replacement.fill('aba');
    await all.click();
    await expect(feedback(page)).toHaveText('No text changed.');
    await workspaceHistory(page);
    await expect(text(page)).toHaveText(['live ABA', 'ABA']);
    await expect(start).toHaveValue('0:');

    const hidden = await delayExport(page);
    await replacement.fill('later');
    await all.click();
    const interrupted = await hidden.requested;
    const canceled = page.waitForEvent('requestfailed', request => request === interrupted);
    await sameTab(page.getByRole('link', { name: 'Settings', exact: true }));
    const leave = page.getByRole('dialog', { name: 'Leave workspace', exact: true });
    await expect(leave).toBeVisible();
    await expect(workspace(page)).toBeVisible();
    await canceled;
    await hidden.resume();
    await leave.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(replacement).toHaveValue('later');
    await expect(text(page)).toHaveText(['live ABA', 'ABA']);
    await expect(start).toHaveValue('0:');
    await expect(all).toBeEnabled();
    await replacement.fill('');
    await all.click();
    await expect(feedback(page)).toHaveText('Replaced 2 matches.');
    expect(await text(page).first().textContent()).toBe('live ');
    await expect(editor).toHaveValue('');
  });
});
