import { openLocalWorkspace, enterLocalWorkspace } from './local-workspace.mjs';
import assert from 'node:assert/strict';
import { dirname, join, resolve } from 'node:path';

/** Isolated editor page: exercise real Spectrum clicks and the complete commit/advance flow. */
export async function checkCommitTiming(browser, url, videoFile) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const dialogs = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('dialog', dialog => { dialogs.push(dialog.type()); void dialog.accept(); });
  try {
    await openLocalWorkspace(page, url);
    await page.waitForFunction(() => !document.querySelector('.file-actions button.primary').disabled);
    // The untouched default row must not trigger an unsaved-changes refresh prompt.
    await page.locator('h1').click(); await page.reload(); await enterLocalWorkspace(page);
    await page.waitForFunction(() => !document.querySelector('.file-actions button.primary').disabled);
    assert.deepEqual(dialogs, []);
    assert.equal(await page.locator('.cue-list tbody tr').count(), 1);
    assert.deepEqual(await page.locator('.cue-list tbody tr').first().locator('.time-cell').allTextContents(), ['0:00:00.00', '0:00:02.00']);
    assert.equal(await page.getByRole('button', { name: '选择第 1 行', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await page.getByLabel('字幕中文文本').isEnabled(), true);
    assert.equal(await page.getByLabel('字幕中文文本').inputValue(), '');
    assert.equal(await page.getByRole('button', { name: /循环试听|提交并下一条/ }).count(), 0);
    await page.getByLabel('导入本地视频').setInputFiles(videoFile);
    await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
    const stage = page.locator('.audio-stage');
    const start = page.getByRole('textbox', { name: '入点', exact: true });
    const end = page.getByRole('textbox', { name: '出点', exact: true });
    const rows = page.locator('.cue-list tbody tr');
    const times = index => rows.nth(index).locator('.time-cell').allTextContents();
    const selected = number => page.getByRole('button', { name: `选择第 ${number} 行`, exact: true }).getAttribute('aria-pressed');
    const commit = async key => { await stage.focus(); await page.keyboard.press(key); };
    const readView = () => page.locator('.audio-timeline').evaluate(el => ({ start: Number(el.dataset.start), end: Number(el.dataset.end) }));
    const readPixel = (time, hz = 20000) => page.locator('.audio-stage canvas').evaluate((canvas, { time, hz }) => {
      const timeline = canvas.closest('.audio-timeline');
      const start = Number(timeline.dataset.start); const end = Number(timeline.dataset.end);
      const top = 22 * canvas.height / canvas.getBoundingClientRect().height;
      const x = Math.floor((time - start) / (end - start) * canvas.width);
      const y = Math.floor(top + (canvas.height - top) * (1 - hz / 24000));
      return [...canvas.getContext('2d').getImageData(x, y, 1, 1).data];
    }, { time, hz });
    const settleDraw = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const assertCaps = async edge => {
      assert.equal(await edge.locator('.boundary-cap').count(), 2);
      const stageBox = await stage.boundingBox();
      const top = await edge.locator('.boundary-cap.top').boundingBox();
      const bottom = await edge.locator('.boundary-cap.bottom').boundingBox();
      assert(Math.abs(top.y - stageBox.y - 22) < 1);
      assert(Math.abs(bottom.y + bottom.height - stageBox.y - stageBox.height) < 1);
      assert.equal(await edge.locator('.boundary-cap.top').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    };
    const clickTime = async (seconds, button) => {
      const view = await page.locator('.audio-timeline').evaluate(el => ({ start: Number(el.dataset.start), end: Number(el.dataset.end) }));
      const rect = await stage.boundingBox();
      await stage.click({ button, position: { x: (seconds - view.start) / (view.end - view.start) * rect.width, y: rect.height * 0.65 } });
    };
    const assertBoundary = async (point, time) => {
      const boundary = page.getByRole('slider', { name: new RegExp(`^字幕${point}`) });
      assert.equal(Number(await boundary.getAttribute('aria-valuenow')), time * 1000);
      const marker = await boundary.boundingBox(); const rect = await stage.boundingBox(); const view = await readView();
      const expected = rect.x + (time - view.start) / (view.end - view.start) * rect.width;
      assert(Math.abs(marker.x + marker.width / 2 - expected) < 1);
      await assertCaps(boundary);
    };
    const assertContext = async ranges => {
      const view = await readView(); const rect = await stage.boundingBox();
      const visible = ranges.filter(([start, end]) => end > view.start && start < view.end);
      const intervals = page.locator('.audio-cue-interval');
      assert.equal(await intervals.count(), visible.length);
      for (let i = 0; i < visible.length; i++) {
        const [start, end] = visible[i]; const interval = intervals.nth(i); const box = await interval.boundingBox();
        const left = Math.max(0, (start - view.start) / (view.end - view.start) * rect.width);
        const right = Math.min(rect.width, (end - view.start) / (view.end - view.start) * rect.width);
        assert(Math.abs(box.x - rect.x - left) < 1);
        assert(Math.abs(box.width - (right - left)) < 1);
        assert.equal(await interval.evaluate(el => getComputedStyle(el).pointerEvents), 'none');
        for (const point of ['start', 'end']) {
          const edge = interval.locator(`.cue-edge.${point}`);
          if (await edge.count()) await assertCaps(edge);
        }
      }
    };
    assert.equal(await page.getByRole('button', { name: '创建新行', exact: true }).count(), 0);
    const initialView = await readView();
    await assertBoundary('入点', 0); await assertBoundary('出点', 2);
    await settleDraw();
    const decodedBeforeRecolor = await page.locator('.audio-timeline').getAttribute('data-decoded-segments');
    assert.deepEqual(await readPixel(1.5), [64, 32, 96, 255]);
    const activeTone = await readPixel(1.5, 1000);
    await start.fill('0:00:03.00'); await end.fill('0:00:04.00'); await settleDraw();
    assert.deepEqual(await readPixel(1.5), [8, 8, 12, 255]);
    const normalTone = await readPixel(1.5, 1000);
    assert.notDeepEqual(activeTone, normalTone);
    assert.equal(await page.locator('.audio-timeline').getAttribute('data-decoded-segments'), decodedBeforeRecolor);
    await start.fill('0:00:00.00'); await end.fill('0:00:02.00');
    await clickTime(1.2, 'left');
    await assertBoundary('入点', 1.2);
    assert.equal(await rows.count(), 1); // Timing edits remain a draft on the default row until G.
    assert.deepEqual(await times(0), ['0:00:00.00', '0:00:02.00']);
    assert.equal(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true }))), false);
    await clickTime(2.4, 'right'); await assertBoundary('出点', 2.4);
    await commit('KeyG');
    assert.equal(await rows.count(), 2);
    assert.deepEqual(await times(0), ['0:00:01.20', '0:00:02.40']);
    assert.deepEqual(await times(1), ['0:00:02.40', '0:00:04.40']);
    assert.equal(await selected(2), 'true');
    assert.equal(await page.getByLabel('字幕中文文本').inputValue(), '');
    assert.deepEqual(await readView(), initialView);
    await assertContext([[1.2, 2.4]]);
    await settleDraw();
    assert.deepEqual(await readPixel(1.5), [32, 24, 40, 255]);
    const inactiveTone = await readPixel(1.5, 1000);
    assert.notDeepEqual(inactiveTone, normalTone); assert.notDeepEqual(inactiveTone, activeTone);
    await start.fill('0:00:01.20'); await settleDraw();
    assert.deepEqual(await readPixel(1.5), [64, 32, 96, 255]); // Current draft wins an overlap.
    await start.fill('0:00:02.40');

    // The next draft starts at the previous end; only its end needs a new click.
    await page.getByLabel('字幕中文文本').fill('连续打轴');
    await clickTime(5.1, 'right');
    await commit('Enter');
    assert.equal(await rows.count(), 3);
    assert.deepEqual(await times(1), ['0:00:02.40', '0:00:05.10']);
    assert.equal(await rows.nth(1).locator('.cue-text').textContent(), '连续打轴');
    assert.deepEqual(await times(2), ['0:00:05.10', '0:00:07.10']);
    assert.equal(await selected(3), 'true');
    assert.equal(await page.getByLabel('字幕中文文本').inputValue(), '');
    assert.deepEqual(await readView(), initialView);
    await assertContext([[1.2, 2.4], [2.4, 5.1]]);
    const contextScreenshot = join(dirname(videoFile), 'subtitle-intervals.png');
    await stage.screenshot({ path: contextScreenshot });
    // Prior subtitle bands do not intercept new timing clicks.
    await clickTime(1.7, 'left'); await assertBoundary('入点', 1.7);
    assert.deepEqual(await times(2), ['0:00:05.10', '0:00:07.10']);
    await start.fill('0:00:05.10');
    await stage.dispatchEvent('wheel', { deltaX: 0, deltaY: 100, deltaMode: 0 });
    await assertContext([[1.2, 2.4], [2.4, 5.1]]);
    const zoomRect = await stage.boundingBox();
    await stage.dispatchEvent('wheel', { deltaX: 0, deltaY: -100, deltaMode: 0, shiftKey: true, clientX: zoomRect.x + zoomRect.width / 2 });
    await assertContext([[1.2, 2.4], [2.4, 5.1]]);

    // Invalid ranges and typing Enter inside a time field cannot advance the selection.
    await end.fill('0:00:05.10'); await commit('KeyG');
    assert.equal(await rows.count(), 3);
    assert.equal(await selected(3), 'true');
    assert.equal(await end.inputValue(), '0:00:05.10');
    assert((await page.locator('.error').textContent()).includes('入点必须早于出点'));
    await end.fill('0:00:08.00'); await page.keyboard.press('Enter');
    assert.equal(await rows.count(), 3);
    assert.deepEqual(await times(2), ['0:00:05.10', '0:00:07.10']);

    await page.getByLabel('导入基础 ASS').setInputFiles(resolve('../backend/ass_format/fixtures/basic.ass'));
    await page.getByRole('button', { name: '替换当前字幕', exact: true }).click();
    await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
    await start.fill('0:00:01.30'); await end.fill('0:00:03.50');
    await commit('KeyG');
    assert.equal(await rows.count(), 2);
    assert.deepEqual(await times(0), ['0:00:01.30', '0:00:03.50']);
    assert.deepEqual(await times(1), ['0:00:02.50', '0:00:04.00']);
    assert.equal(await selected(2), 'true');
    assert.equal(await page.getByLabel('字幕样式').inputValue(), 'Emphasis');
    assert((await page.getByLabel('字幕中文文本').inputValue()).includes('重叠字幕'));

    await end.fill('0:00:04.80'); await commit('NumpadEnter');
    assert.equal(await rows.count(), 3);
    assert.deepEqual(await times(2), ['0:00:04.80', '0:00:06.80']);
    assert.equal(await selected(3), 'true');
    assert.equal(await page.getByLabel('字幕样式').inputValue(), 'Emphasis');
    assert.equal(await page.getByLabel('字幕中文文本').inputValue(), '');
    // Native word/line deletion in inputs must not delete the selected subtitle.
    await end.focus(); await page.keyboard.press('Control+Delete');
    await page.getByLabel('字幕中文文本').fill('keep this row');
    await page.keyboard.press('Meta+Backspace');
    assert.equal(await rows.count(), 3);
    assert.equal(await selected(3), 'true');
    await stage.focus();
    await stage.dispatchEvent('compositionstart'); await page.keyboard.press('Control+Delete'); await stage.dispatchEvent('compositionend');
    assert.equal(await rows.count(), 3);
    await page.getByLabel('导入基础 ASS').setInputFiles(resolve('../backend/ass_format/fixtures/basic.ass'));
    await page.getByRole('button', { name: '替换当前字幕', exact: true }).waitFor();
    await page.keyboard.press('Control+Delete'); assert.equal(await rows.count(), 3);
    await page.getByRole('button', { name: '取消', exact: true }).click();

    await stage.focus(); await page.keyboard.press('Control+Delete');
    assert.equal(await rows.count(), 2); assert.equal(await selected(2), 'true');
    assert.equal(await end.inputValue(), '0:00:04.80');
    await page.keyboard.press('Meta+Backspace');
    assert.equal(await rows.count(), 1); assert.equal(await selected(1), 'true');
    await page.keyboard.press('Meta+Delete');
    assert.equal(await rows.count(), 0);
    assert.equal(await start.inputValue(), '0:00:00.00'); assert.equal(await end.inputValue(), '0:00:00.00');
    assert.equal(await page.locator('.audio-cue-interval').count(), 0);
    await page.keyboard.press('Control+Backspace'); assert.equal(await rows.count(), 0);
    const emptySource = await page.evaluate(async () => (await (await fetch('/api/ass/empty')).json()).document.source);
    await page.getByLabel('导入基础 ASS').setInputFiles({ name: 'empty.ass', mimeType: 'text/plain', buffer: Buffer.from(emptySource) });
    await page.waitForFunction(() => document.querySelector('.cue-list tbody tr')?.classList.contains('selected'));
    assert.equal(await rows.count(), 1);
    assert.deepEqual(await times(0), ['0:00:00.00', '0:00:02.00']);
    assert.equal(await page.getByLabel('字幕中文文本').inputValue(), '');
    await assertBoundary('入点', 0); await assertBoundary('出点', 2);
    assert.deepEqual(errors, []);
    return { defaultTwoSecondRow: true, emptyImportDefaultRow: true, pristineRefreshWithoutPrompt: true, editedDraftGuarded: true,
      timingButtonsRemoved: true, firstDraftMarkers: true, priorIntervalsVisible: true, intervalPalettes: true, draftPalettePriority: true,
      recolorWithoutDecode: true, allBoundaryCaps: true, contextScreenshot, deleteRowShortcuts: true,
      contiguousTwoSeconds: true, existingNextPreserved: true, styleInherited: 'Emphasis', invalidDraftPreserved: true, keys: ['G', 'Enter', 'NumpadEnter'], errors };
  } finally { await page.close(); }
}
