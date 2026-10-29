import { openLocalWorkspace } from './local-workspace.mjs';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Real pointer/keyboard sequences, including native button and IME safeguards. */
export async function checkShortcutFocus(browser, url, videoFile) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  try {
    await openLocalWorkspace(page, url);
    await page.waitForFunction(() => !document.querySelector('.file-actions button.primary').disabled);
    await page.getByLabel('导入本地视频').setInputFiles(videoFile);
    await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
    await page.getByLabel('导入基础 ASS').setInputFiles(resolve('../backend/ass_format/fixtures/basic.ass'));
    const rows = page.locator('.cue-list tbody tr');
    const stage = page.locator('.audio-stage');
    const end = page.getByRole('textbox', { name: '出点', exact: true });
    const selected = n => page.getByRole('button', { name: `选择第 ${n} 行`, exact: true }).getAttribute('aria-pressed');
    const activeTag = () => page.evaluate(() => document.activeElement.tagName);
    assert.equal(await page.locator('.time-point button').count(), 0);

    // No manual blur/focus: Enter after a mouse row selection must advance.
    await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
    assert.equal(await activeTag(), 'MAIN');
    await page.keyboard.press('Enter');
    assert.equal(await selected(2), 'true');
    assert.equal(await rows.count(), 2);

    // A mouse action must return focus to the editor so Space plays the selection.
    await page.getByRole('button', { name: '定位选中行', exact: true }).click();
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.auditionPhase === 'playing');
    assert.equal(await page.locator('.audio-timeline').getAttribute('data-mode'), 'spectrum');
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return video.paused && Math.abs(video.currentTime - 2.5) < 0.02 && document.querySelector('.audio-timeline')?.dataset.auditionPhase === 'finished' && Number(document.querySelector('.audio-timeline').dataset.auditionTime) === 4000;
    });

    // Tab-navigation still focuses buttons; Enter/Space keep native activation.
    await page.getByRole('button', { name: '定位选中行', exact: true }).focus();
    assert.equal(await page.evaluate(() => document.activeElement.textContent), '定位选中行');
    await page.keyboard.press('Enter');
    assert.equal(await selected(2), 'true');
    assert.equal(await activeTag(), 'BUTTON');
    await page.keyboard.press('Space');
    assert.equal(await page.locator('video').evaluate(video => video.paused), true);

    // Right-clicking the spectrum must leave a formerly focused time input.
    await end.focus();
    const view = await page.locator('.audio-timeline').evaluate(el => ({ start: Number(el.dataset.start), end: Number(el.dataset.end) }));
    const rect = await stage.boundingBox();
    await stage.click({ button: 'right', position: { x: (3.7 - view.start) / (view.end - view.start) * rect.width, y: rect.height * 0.65 } });
    assert.equal(await end.inputValue(), '0:00:03.70');
    assert.equal(await stage.evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('KeyG');
    assert.deepEqual(await rows.nth(1).locator('.time-cell').allTextContents(), ['0:00:02.50', '0:00:03.70']);
    assert.equal(await selected(3), 'true');

    // Boundary sliders keep arrow editing, plus Enter/Space timing actions.
    const boundary = page.getByRole('slider', { name: /^字幕入点/ });
    await boundary.click();
    assert.equal(await boundary.evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('ArrowRight');
    assert.equal(await page.getByRole('textbox', { name: '入点', exact: true }).inputValue(), '0:00:03.71');
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.auditionPhase === 'playing');
    await page.waitForFunction(() => {
      const video = document.querySelector('video');
      return video.paused && Math.abs(video.currentTime - 2.5) < 0.02 && document.querySelector('.audio-timeline')?.dataset.auditionPhase === 'finished' && Number(document.querySelector('.audio-timeline').dataset.auditionTime) === 5700;
    });
    await page.keyboard.press('Enter');
    assert.equal(await rows.count(), 4);
    assert.equal(await selected(4), 'true');
    assert.deepEqual(await rows.nth(2).locator('.time-cell').allTextContents(), ['0:00:03.71', '0:00:05.70']);

    // Typing and IME composition must never submit rows or play audio.
    const text = page.getByLabel('字幕中文文本');
    await text.fill(''); await page.keyboard.type('gsqwed '); await page.keyboard.press('Enter');
    assert.equal(await text.inputValue(), 'gsqwed \\N');
    assert.equal(await rows.count(), 4);
    assert.equal(await page.locator('video').evaluate(video => video.paused), true);
    await stage.focus();
    await stage.dispatchEvent('compositionstart');
    for (const key of ['KeyG', 'Enter', 'Space']) await page.keyboard.press(key);
    await stage.dispatchEvent('compositionend');
    assert.equal(await rows.count(), 4);
    assert.equal(await page.locator('video').evaluate(video => video.paused), true);
    assert.deepEqual(errors, []);
    return { mouseButtons: true, rightClickFromInput: true, sliderEnterAndSpace: true, nativeTabActivation: true, typingAndComposition: true, timeButtonsRemoved: true, errors };
  } finally { await page.close(); }
}
