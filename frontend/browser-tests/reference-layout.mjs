// Real Chrome, generated media and isolated HTTP fixtures; no development database writes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { uiDocument } from './ass-codec.mjs';
import { unavailableAssPreview } from './ass-preview-fixture.mjs';

const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-reference-layout-'));
const file = join(artifacts, 'video.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
  'color=c=black:s=160x90:r=10:d=8', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
const bytes = readFileSync(file), documentFixture = uiDocument();
documentFixture.cues = Array.from({ length: 40 }, (_, index) => ({ id: `cue-${index}`, start_ms: index * 100,
  end_ms: index * 100 + 100, style_id: documentFixture.styles[0].id, text: `字幕 ${index + 1}` }));
let project = { id: 7, organization_id: 1, name: '布局验证项目', description: '', status: 'active', revision: 3,
  media: { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), duration_ms: 8000 }, document: documentFixture };
project.reference = { version: 1, cues: [
  { start_ms: 0, end_ms: 500, text: 'Reference translation to keep visible while editing.' },
  { start_ms: 0, end_ms: 500, text: 'Second overlapping reference.' },
  { start_ms: 1000, end_ms: 2000, text: 'Next reference context.' },
] };
const settings = { shortcut_overrides: {}, audio_display_mode: 'spectrum', mouse_sets_cue_boundary: true };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 900 }, acceptDownloads: false });
const errors = [], unexpected = [], checks = [];
context.on('page', page => page.on('pageerror', error => errors.push(String(error))));
await context.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname;
  if (await unavailableAssPreview(route)) return;
  const fixtures = {
    '/api/auth/session': { user: { id: 1, username: 'layout', is_dev: false } },
    '/api/organizations': { organizations: [{ id: 1, name: '布局组织', role: 'organizer', can_manage: true }] },
    '/api/me/settings': settings, '/api/ass/empty': { document: documentFixture },
    '/api/organizations/1/projects/7': { project },
    '/api/organizations/1/glossary': { association_version: 1, table: null, uses_organization_default: true, archived: false, entries: [], total: 0, page: 1, has_more: false, empty: true },
    '/api/organizations/1/projects/7/glossary': { association_version: 1, table: null, uses_organization_default: true, archived: project.status === 'archived', entries: [], total: 0, page: 1, has_more: false, empty: true },
    '/api/organizations/1/projects': { projects: [], total: 0, page: 1, has_more: false },
    '/api/organizations/1/members': { members: [] },
  };
  if (fixtures[path]) return route.fulfill({ json: fixtures[path] });
  unexpected.push(`${route.request().method()} ${path}`); return route.abort();
});
const page = await context.newPage();
page.setDefaultTimeout(10000); page.on('dialog', dialog => dialog.accept());
const origin = process.env.REFERENCE_LAYOUT_URL || 'http://127.0.0.1:5173';
const text = page.getByLabel('字幕中文文本');
const panel = page.locator('[data-reference-subtitles]');
const separator = page.getByRole('separator', { name: '调整视频区域大小', exact: true });
const settle = () => page.evaluate(() => new Promise((resolve, reject) => {
  const started = performance.now(); let previous = '', stableFrames = 0;
  const sample = () => {
    const current = JSON.stringify([...document.querySelectorAll('.workbench,.media-panel,.transport,.reference-panel,.cue-editor')]
      .map(node => { const rect = node.getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height]; }));
    stableFrames = current === previous ? stableFrames + 1 : 0; previous = current;
    if (stableFrames >= 3) resolve();
    else if (performance.now() - started > 2000) reject(new Error('Workbench geometry did not settle'));
    else requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}));
async function replaceReference(cues) {
  project = { ...project, reference: { version: project.reference.version + 1, cues } };
  const read = page.waitForResponse(response => new URL(response.url()).pathname === '/api/organizations/1/projects/7');
  await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await read; await settle();
}
async function geometry() {
  await settle();
  return page.evaluate(() => {
    const box = selector => document.querySelector(selector)?.getBoundingClientRect().toJSON();
    const content = document.querySelector('.reference-content');
    return { upper: box('.workbench'), list: box('.cue-list'), media: box('.media-panel'), frame: box('.video-stage'),
      transport: box('.transport'), clock: box('.time-display'), play: box('.playback-button'), progress: box('.video-progress'), footer: box('.media-footer'), reference: box('[data-reference-subtitles]'), content: box('.reference-content'),
      editorColumn: box('.editing-panel'), editor: box('.cue-editor'), text: box('[aria-label="字幕中文文本"]'),
      actions: [...document.querySelectorAll('.transport-actions > button')].map(node => node.getBoundingClientRect().toJSON()),
      fields: [...document.querySelectorAll('.cue-fields input,.cue-fields select')].map(node => node.getBoundingClientRect().toJSON()),
      fitsWidth: document.documentElement.scrollWidth <= innerWidth, fitsHeight: document.documentElement.scrollHeight <= innerHeight,
      scrolls: content && content.scrollHeight > content.clientHeight,
      sameVideo: document.querySelector('video') === window.layoutVideo };
  });
}
function assertLayout(g, desktop = true) {
  assert.equal(g.actions.length, 2, 'reference and preview share the action group after import');
  assert(Math.max(...g.actions.map(action => action.y)) - Math.min(...g.actions.map(action => action.y)) < .5, 'both action buttons remain on one row');
  assert(g.fitsWidth, 'no page-wide horizontal overflow');
  assert(g.reference.y >= g.transport.bottom, 'reference follows playback controls');
  assert(g.content.height >= 50, 'reference retains room for three compact lines');
  assert(Math.abs(g.frame.width / g.frame.height - 16 / 9) < .01, 'video preserves aspect ratio');
  assert(g.sameVideo, 'layout keeps the same media node');
  if (desktop) {
    assert(Math.abs(g.media.width - g.frame.width) < 1, 'video fills the media column without side whitespace');
    assert(g.fitsHeight, 'desktop remains within viewport');
    assert(g.reference.bottom <= g.media.bottom + 1, 'reference stays inside media column');
    assert(g.reference.right <= g.media.right + 1, 'reference stays inside media width');
    assert(g.list.height >= 144, 'subtitle list retains minimum height');
    assert(Math.abs(g.reference.bottom - g.text.bottom) < .5, 'reference bottom inset matches subtitle textarea bottom inset');
    assert(g.text.y >= g.editor.y && g.text.bottom <= g.editor.bottom + 1, 'whole translation input remains in view');
    assert(g.fields.every(field => field.y >= g.editor.y && field.bottom <= g.editor.bottom + 1), 'all timing/style controls remain in view');
  } else {
    assert(g.reference.bottom <= g.editor.y, 'narrow order places reference before editor');
  }
}
try {
  await page.goto(`${origin}/organizations/1/projects/7/workspace`);
  const importButton = page.getByRole('button', { name: '导入视频', exact: true });
  await importButton.waitFor();
  const importPlacement = await page.locator('.video-stage').evaluate(node => {
    const stage = node.getBoundingClientRect(), button = node.querySelector('.file-picker').getBoundingClientRect();
    return { x: (button.left + button.right - stage.left - stage.right) / 2,
      y: (button.top + button.bottom - stage.top - stage.bottom) / 2 };
  });
  assert(Math.abs(importPlacement.x) < 1 && Math.abs(importPlacement.y) < 1, 'import action is centered in the video');
  assert.equal(await page.locator('.transport .file-picker').count(), 0);
  await page.screenshot({ path: join(artifacts, 'centered-import.png'), fullPage: true });
  await page.getByLabel('导入本地视频').setInputFiles(file);
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
  assert.equal(await importButton.count(), 0, 'successful verified import removes its button');
  assert.equal(await page.getByRole('button', { name: '显示预览字幕', exact: true }).textContent(), '隐藏预览字幕');
  assert(await page.locator('.time-display').evaluate(node => parseFloat(getComputedStyle(node).fontSize) <= 13));
  await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  await text.fill('翻译时参考字幕与输入框需要同时可见');
  await page.locator('video').evaluate(node => { window.layoutVideo = node; });
  const reference = project.reference.cues;
  const expanded = await geometry(); assertLayout(expanded);
  assert.equal(await panel.locator('button').count(), 0, 'reference content has no separate title row');
  assert.equal(await page.locator('.reference-toggle').getAttribute('aria-controls'), await panel.getAttribute('id'));
  const oldHeader = await page.addStyleTag({ content: `.reference-panel::before { content: '收起参考字幕'; display: block; flex: none; height: 22px; }` });
  const withHeader = await geometry(); await oldHeader.evaluate(node => node.remove());
  const withoutHeader = await geometry();
  assert(Math.abs(withoutHeader.content.height - withHeader.content.height - 22) < 1, 'removed title row becomes reference text space');
  assert.equal(withoutHeader.upper.height, withHeader.upper.height);
  assert.equal(withoutHeader.list.height, withHeader.list.height);
  const toggle = page.locator('.reference-toggle');
  const previewToggle = page.getByRole('button', { name: '显示预览字幕', exact: true });
  const buttonStyle = button => button.evaluate(node => {
    const style = getComputedStyle(node);
    return [style.color, style.backgroundColor, style.borderColor];
  });
  const settleButtonStyles = () => page.locator('.transport-actions').evaluate(node =>
    Promise.all(node.getAnimations({ subtree: true }).map(animation => animation.finished)));
  await page.mouse.move(0, 0);
  await settleButtonStyles();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(await buttonStyle(toggle), await buttonStyle(previewToggle), 'expanded reference shares the enabled preview style');
  await toggle.focus(); await page.keyboard.press('Space'); await settle();
  assert(await panel.evaluate(node => node.hidden), 'keyboard activation collapses reference');
  assert.notEqual(await page.locator('.audio-timeline').getAttribute('data-audition-phase'), 'playing', 'reference toggle does not start an audition');
  await previewToggle.click(); await page.mouse.move(0, 0);
  await settleButtonStyles();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await previewToggle.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(await buttonStyle(toggle), await buttonStyle(previewToggle), 'collapsed reference shares the disabled preview style');
  await toggle.focus();
  await page.keyboard.press('Space'); await settle();
  assert(await toggle.evaluate(node => node === document.activeElement), 'keyboard activation preserves toggle focus');
  await previewToggle.click(); await page.mouse.move(0, 0);
  await settleButtonStyles();
  assert.equal(await previewToggle.getAttribute('aria-pressed'), 'true');
  assert.deepEqual(await buttonStyle(toggle), await buttonStyle(previewToggle), 'expanding reference restores the enabled preview style');
  checks.push('import is centered until verification; compact clock and renamed reference/preview actions remain usable; reference toggle exposes its panel relationship and isolates keyboard playback');
  const previousControlGap = await page.addStyleTag({ content: `
    .workbench { --video-controls-reserve: 92px; }
    .transport { margin-top: 8px; }
    .media-panel:has(.media-footer) { --media-footer-space: 80px; }
  ` });
  const beforeControlGap = await geometry(); await previousControlGap.evaluate(node => node.remove());
  const tighterControls = await geometry();
  assert(tighterControls.transport.top - tighterControls.progress.bottom <= 2.5, 'transport follows the progress slider closely');
  assert(Math.abs(tighterControls.footer.height - beforeControlGap.footer.height - 6) < 1, 'saved transport gap becomes reference space');
  assert(Math.abs(tighterControls.frame.width - beforeControlGap.frame.width) < 1, 'tighter transport preserves video width');
  assert(Math.abs(tighterControls.list.height - beforeControlGap.list.height) < 1, 'saved transport gap stays in the reference column');
  checks.push('transport gap shrinks from 8px to 2px; the reference gets 6px without changing video or list sizes');
  const referenceGap = tighterControls.reference.top - tighterControls.transport.bottom;
  const inputGap = tighterControls.text.top - Math.max(...tighterControls.fields.map(field => field.bottom));
  assert(Math.abs(referenceGap - inputGap) < .5, 'reference-to-controls gap matches timing-to-text input gap');
  assert(referenceGap <= 4.5, 'short references do not add space above their border');
  checks.push('reference-to-controls gap matches the 4px timing-to-text input gap');
  const previousSpacing = await page.addStyleTag({ content: `
    .workbench { padding-top: 12px; padding-bottom: 12px; --video-controls-space: 96px !important;
      flex-basis: max(var(--default-workbench-height), var(--requested-workbench-height, 0px)); }
    .media-panel:has(.media-footer) { --media-footer-space: 80px; }
  ` });
  const beforeCompact = await geometry(); await previousSpacing.evaluate(node => node.remove());
  const compact = await geometry();
  assert(Math.abs(compact.list.height - beforeCompact.list.height - 48) < 1, 'unused controls reserve and bottom padding go to subtitle list');
  assert(Math.abs(compact.frame.height - beforeCompact.frame.height - 8) < 1, 'tighter top and progress spacing gives the video another 8px of height');
  assert(Math.abs(compact.reference.bottom - compact.text.bottom) < .5, 'reference and editor share the same bottom inset');
  checks.push('compact layout gives 48px to the subtitle list; tighter top and progress spacing gives the video another 8px of height');
  assert.equal(await panel.locator('[data-reference-current]').count(), 2);
  await text.focus(); await page.getByRole('button', { name: '收起参考字幕', exact: true }).click();
  assert(await text.evaluate(node => node === document.activeElement), 'collapse preserves translation focus');
  assert.equal(await panel.locator('.reference-content').count(), 0);
  const collapsed = await geometry();
  assert.equal(collapsed.upper.height, expanded.upper.height); assert.equal(collapsed.list.height, expanded.list.height);
  await page.getByRole('button', { name: '展开参考字幕', exact: true }).click();
  assert(await text.evaluate(node => node === document.activeElement), 'expand preserves translation focus');
  await replaceReference(null); assert.equal(await panel.count(), 0);
  assert.equal(await toggle.count(), 0, 'no reference leaves no toolbar toggle');
  assert.equal(await page.locator('.media-footer').count(), 0, 'no reference leaves no slot');
  const empty = await geometry(); assert.equal(empty.upper.height, expanded.upper.height); assert.equal(empty.list.height, expanded.list.height);
  await page.screenshot({ path: join(artifacts, 'without-reference.png'), fullPage: true });
  await replaceReference(reference);
  checks.push('arrival, removal and collapse retain upper/list heights and input focus; no empty reference slot');

  for (const viewport of [{ width: 1440, height: 900 }, { width: 1440, height: 600 }, { width: 1440, height: 540 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const g = await geometry(); assertLayout(g, viewport.width > 900);
    if (viewport.width >= 1024) {
      assert(g.clock.top >= g.play.top && g.clock.bottom <= g.play.bottom, 'clock shares the playback row');
      assert(g.actions.every(action => action.left >= g.media.left && action.right <= g.media.right + 1
        && action.top >= g.play.top && action.bottom <= g.transport.bottom + 1), 'actions remain inside the narrower transport, wrapping when needed');
    }
    if (viewport.width === 1440 && viewport.height === 600) {
      // Reproduce the previous 400px column to measure where its unused width goes.
      const oldWidth = await page.addStyleTag({ content: '.workbench { grid-template-columns: 400px 16px minmax(0, 1fr); }' });
      const before = await geometry(); await oldWidth.evaluate(node => node.remove());
      const after = await geometry(); assertLayout(after);
      assert(Math.abs(after.frame.width - before.frame.width) < 1, 'removing whitespace preserves the original video size');
      assert(Math.abs(after.editorColumn.width - before.editorColumn.width - (before.media.width - before.frame.width)) < 1,
        'all recovered width goes to the frequency spectrum and subtitle editor');
      checks.push('height-limited video keeps its size while all side whitespace goes to the editor; controls wrap within the narrower column');
    }
    await text.fill('翻译时参考字幕与输入框需要同时可见');
    await page.getByRole('textbox', { name: '入点', exact: true }).fill('0:00:00.00');
    await page.getByRole('textbox', { name: '出点', exact: true }).fill('0:00:00.10');
    assert(await page.getByLabel('字幕样式', { exact: true }).isEnabled());
    await page.getByRole('button', { name: '播放 / 暂停', exact: true }).click();
    assert(await page.locator('video').evaluate(node => !node.paused), 'playback control works');
    await page.getByRole('button', { name: '播放 / 暂停', exact: true }).click();
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: join(artifacts, `reference-${viewport.width}x${viewport.height}.png`), fullPage: true });
    await text.focus(); await page.getByRole('button', { name: '收起参考字幕', exact: true }).click();
    assert(await text.evaluate(node => node === document.activeElement));
    assert.equal(await panel.locator('.reference-content').count(), 0);
    assert((await geometry()).fitsWidth);
    await page.getByRole('button', { name: '展开参考字幕', exact: true }).click();
    await replaceReference(null); assert.equal(await page.locator('.media-footer').count(), 0);
    assert((await geometry()).fitsWidth);
    await replaceReference(reference); assertLayout(await geometry(), viewport.width > 900);
    checks.push({ viewport, video: g.frame, reference: g.reference, referenceTextHeight: g.content.height, subtitleHeight: g.list.height });
  }
  // The media column fits the frame; repeated small gestures must not cause jumps.
  for (const viewport of [{ width: 1440, height: 600 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, 5]]) {
      await separator.dblclick({ position: { x: 8, y: 40 } });
      for (let gesture = 0; gesture < 2; gesture++) {
        const previous = await geometry(), box = await separator.boundingBox();
        const x = box.x + 8, y = box.y + 40;
        await page.mouse.move(x, y); await page.mouse.down();
        await page.mouse.move(x + dx, y + dy); await page.mouse.up();
        const after = await geometry(); assertLayout(after);
        assert(Math.abs(after.frame.width - previous.frame.width) <= Math.abs(dx) + 1, 'small drag cannot enlarge the frame to fill the media column');
        assert(Math.abs(after.upper.height - previous.upper.height) <= Math.abs(dx) * 9 / 16 + 1, 'small drag transfers only its own height delta');
        if (dx <= 0) assert(after.frame.width <= previous.frame.width + .5, 'leftward or vertical drag cannot enlarge the video');
      }
    }
    await separator.dblclick({ position: { x: 8, y: 40 } });
    const beforeKey = await geometry();
    await separator.focus(); await page.keyboard.press('ArrowRight');
    const afterKey = await geometry(); assertLayout(afterKey);
    assert(afterKey.frame.width <= beforeKey.frame.width + 17, 'first keyboard resize changes only the requested frame width');
  }
  checks.push('short reference layouts keep first/repeated 1px, vertical and keyboard resizing continuous');
  await page.setViewportSize({ width: 1440, height: 900 });
  await separator.dblclick({ position: { x: 8, y: 40 } }); await settle();
  const start = await separator.boundingBox();
  await page.mouse.move(start.x + 8, start.y + 40); await page.mouse.down();
  await page.mouse.move(3000, start.y + 40, { steps: 10 }); await page.mouse.up();
  const dragged = await geometry(); assertLayout(dragged); assert(dragged.frame.width > expanded.frame.width);
  await page.screenshot({ path: join(artifacts, 'reference-dragged.png'), fullPage: true });
  await text.focus(); await page.getByRole('button', { name: '收起参考字幕', exact: true }).click();
  assert(await text.evaluate(node => node === document.activeElement));
  await page.getByRole('button', { name: '展开参考字幕', exact: true }).click(); assertLayout(await geometry());
  await page.setViewportSize({ width: 1440, height: 600 }); assertLayout(await geometry());
  await separator.focus(); await page.keyboard.press('Home'); assertLayout(await geometry());
  await page.keyboard.press('End'); assertLayout(await geometry());
  await separator.dblclick({ position: { x: 8, y: 40 } }); assertLayout(await geometry());
  checks.push('pointer/keyboard widening, short-window reclamp and double-click reset keep reference, editor and transport usable');

  await replaceReference(reference.map((cue, i) => i < 2 ? { ...cue, text: ('Long reference line ' + i + ' ').repeat(1000) } : cue));
  let g = await geometry(); assertLayout(g); assert(g.scrolls, 'long multiple matches scroll internally');
  assert.equal(await panel.locator('[data-reference-current]').count(), 2);
  const currentVisible = () => panel.evaluate(node => {
    const current = node.querySelector('[data-reference-current], [data-reference-unmatched]').getBoundingClientRect();
    const content = node.querySelector('.reference-content').getBoundingClientRect();
    return current.top >= content.top && current.top < content.bottom;
  });
  assert(await currentVisible(), 'first current match starts in viewport');
  await page.getByRole('button', { name: '选择第 11 行', exact: true }).click();
  assert.equal(await panel.locator('[data-reference-current]').textContent(), 'Next reference context.');
  assert(await currentVisible(), 'auto-position reveals match after long context');
  assert(await panel.locator('.reference-content').evaluate(node => node.scrollTop > 100));
  await page.getByRole('button', { name: '选择第 9 行', exact: true }).click();
  assert(await panel.locator('[data-reference-unmatched]').isVisible()); assert(await currentVisible());
  await page.screenshot({ path: join(artifacts, 'reference-long-no-match.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); assertLayout(await geometry(), false);
  assert((await geometry()).scrolls);
  checks.push('long text/multiple matches stay internally scrollable on desktop and narrow screens; selection auto-position and gap notice remain visible');
  settings.language_preference = 'en';
  const english = await context.newPage(); await english.goto(`${origin}/organizations/1/projects/7/workspace`);
  await english.getByRole('button', { name: 'Import video', exact: true }).waitFor();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await english.setViewportSize(viewport);
    assert.equal(await english.locator('.reference-toggle').textContent(), 'Collapse reference subtitles');
    assert.equal(await english.getByRole('button', { name: 'Show preview subtitles', exact: true }).textContent(), 'Hide preview subtitles');
    assert(await english.locator('.video-stage').evaluate(node => {
      const stage = node.getBoundingClientRect(), button = node.querySelector('.file-picker').getBoundingClientRect();
      return Math.abs(button.left + button.width / 2 - stage.left - stage.width / 2) < 1
        && Math.abs(button.top + button.height / 2 - stage.top - stage.height / 2) < 1
        && document.documentElement.scrollWidth <= innerWidth;
    }), 'English import remains centered without horizontal overflow');
    if (viewport.width !== 1024) await english.screenshot({ path: join(artifacts, `english-import-${viewport.width}.png`), fullPage: true });
  }
  await english.locator('.video-stage input[type="file"]').setInputFiles(file);
  await english.getByRole('button', { name: 'Import video', exact: true }).waitFor({ state: 'detached' });
  await english.getByRole('button', { name: 'Collapse reference subtitles', exact: true }).click();
  assert(await english.locator('[data-reference-subtitles]').evaluate(node => node.hidden));
  await english.getByRole('button', { name: 'Expand reference subtitles', exact: true }).click();
  assert(await english.locator('.reference-content').isVisible());
  await english.close();
  checks.push('English renamed controls, centered import at desktop/narrow widths, verified import disappearance and reference collapse/expand');
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  const report = { browser: browser.version(), checks, errors, unexpected };
  writeFileSync(join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ artifacts, ...report }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ artifacts, errors, unexpected, geometry: await geometry() }));
  await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }); throw error;
} finally { await browser.close(); }
