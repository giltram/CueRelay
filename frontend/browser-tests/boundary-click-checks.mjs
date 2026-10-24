import { setAudioMode } from './audio-settings.mjs';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Spectrum click timing uses the editor's existing draft and commit flow. */
export async function checkBoundaryClicks(page, selected = false) {
  const originalMode = await page.locator('.audio-timeline').getAttribute('data-mode');
  const start = page.getByRole('textbox', { name: '入点', exact: true });
  const end = page.getByRole('textbox', { name: '出点', exact: true });
  const original = { start: await start.inputValue(), end: await end.inputValue() };
  const readView = () => page.locator('.audio-timeline').evaluate(el => ({ start: Number(el.dataset.start), end: Number(el.dataset.end) }));
  const readTime = () => page.locator('video').evaluate(video => video.currentTime);
  const stage = page.locator('.audio-stage');
  const rowTimes = () => page.locator('.cue-list tbody tr').first().locator('.time-cell').allTextContents();
  const saved = selected ? await rowTimes() : null;
  const videoTime = await readTime();
  await setAudioMode(page, 'spectrum');
  await page.waitForFunction(() => document.querySelector('.audio-timeline').dataset.state === 'ready');
  await page.evaluate(() => {
    window.__lastTimingContextMenu = null;
    // Read the final event after React's handlers, including handlers that stop propagation.
    document.addEventListener('contextmenu', event => { window.__lastTimingContextMenu = event; }, { capture: true });
  });
  let view = await readView();
  const click = async (time, button = 'left') => {
    const rect = await stage.boundingBox();
    const x = (time - view.start) / (view.end - view.start) * rect.width;
    await stage.click({ button, position: { x, y: rect.height * 0.65 } });
  };
  await click(1.8);
  assert.equal(await start.inputValue(), '0:00:01.80');
  assert.equal(await end.inputValue(), original.end);
  await click(2.8, 'right');
  assert.equal(await end.inputValue(), '0:00:02.80');
  assert.equal(await start.inputValue(), '0:00:01.80');
  assert.equal(await page.evaluate(() => window.__lastTimingContextMenu?.defaultPrevented), true);
  assert.equal(await readTime(), videoTime);
  assert.deepEqual(await readView(), view);
  if (selected) {
    assert.deepEqual(await rowTimes(), saved); // Timing remains a draft until G / Enter.
    await stage.focus(); await page.keyboard.press('KeyG');
    assert.deepEqual(await rowTimes(), ['0:00:01.80', '0:00:02.80']);
    await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
    // Both rows already fit: committing/selecting must keep prior context visible.
    assert.deepEqual(await readView(), view);

    // The old end marker must not intercept the next cue's start-time click.
    await click(2.8);
    assert.equal(await start.inputValue(), '0:00:02.80');
    assert.equal(await end.inputValue(), '0:00:02.80');
    assert.deepEqual(await rowTimes(), ['0:00:01.80', '0:00:02.80']);
    const endHandle = page.getByRole('slider', { name: /^字幕出点/ });
    const handle = await endHandle.boundingBox();
    const area = await stage.boundingBox();
    const y = handle.y + handle.height / 2;
    await page.mouse.move(handle.x + handle.width / 2, y);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(area.x + (3.1 - view.start) / (view.end - view.start) * area.width, y, { steps: 8 });
    await page.mouse.up({ button: 'right' });
    assert.equal(await end.inputValue(), '0:00:03.10');
    assert.equal(await start.inputValue(), '0:00:02.80');
    assert.deepEqual(await readView(), view);
    assert.equal(await readTime(), videoTime);

    // Left-dragging the end marker keeps the stage's pan behavior, never moving the end.
    const movedHandle = await endHandle.boundingBox();
    await page.mouse.move(movedHandle.x + movedHandle.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(movedHandle.x + movedHandle.width / 2 - 30, y, { steps: 5 });
    await page.mouse.up();
    assert.equal(await end.inputValue(), '0:00:03.10');
    assert.equal(await start.inputValue(), '0:00:02.80');
    const afterEndPan = await readView();
    assert(afterEndPan.start > view.start);
    await stage.dispatchEvent('wheel', { deltaY: (view.start - afterEndPan.start) / (afterEndPan.end - afterEndPan.start) * area.width, deltaX: 0, deltaMode: 0 });
    await start.fill('0:00:01.80'); await end.fill('0:00:02.80');

    // A background drag keeps panning and does not set either endpoint.
    const rect = await stage.boundingBox();
    await page.mouse.move(rect.x + rect.width * 0.53, rect.y + rect.height * 0.65);
    await page.mouse.down();
    await page.mouse.move(rect.x + rect.width * 0.43, rect.y + rect.height * 0.65, { steps: 6 });
    await page.mouse.up();
    const panned = await readView();
    assert(panned.start > view.start);
    assert.equal(await start.inputValue(), '0:00:01.80'); assert.equal(await end.inputValue(), '0:00:02.80');
    await stage.dispatchEvent('wheel', { deltaY: (view.start - panned.start) / (panned.end - panned.start) * rect.width, deltaX: 0, deltaMode: 0 });

    // A pending replacement disables timing edits through the same callback gate.
    await page.getByLabel('导入基础 ASS').setInputFiles(resolve('../backend/ass_format/fixtures/basic.ass'));
    await page.getByRole('button', { name: '替换当前字幕', exact: true }).waitFor();
    await click(2.1); await click(2.6, 'right');
    assert.equal(await start.inputValue(), '0:00:01.80'); assert.equal(await end.inputValue(), '0:00:02.80');
    assert.equal(await readTime(), videoTime);
    await page.getByRole('button', { name: '取消', exact: true }).click();
  } else {
    assert.equal(await page.locator('.cue-list tbody tr').count(), 1);
    assert.deepEqual(await rowTimes(), ['0:00:00.00', '0:00:02.00']);
    assert.equal(await page.getByRole('button', { name: '提交并下一条 [G / Enter]', exact: true }).count(), 0);
  }
  await start.fill(original.start); await end.fill(original.end);
  if (selected) {
    await stage.focus(); await page.keyboard.press('KeyG'); assert.deepEqual(await rowTimes(), saved);
    await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  }
  if (originalMode === 'waveform') await setAudioMode(page, 'waveform');
  return { start: '0:00:01.80', end: '0:00:02.80', selected, videoUnchanged: true, draftOnlyUntilCommit: true };
}
