// Real Chrome + generated media + the real pure ASS codec; no database writes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { codec, uiDocument } from './ass-codec.mjs';

const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-subtitle-qc-'));
const file = join(artifacts, 'video.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=10:d=20',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file]);
const doc = uiDocument();
doc.cues = Array.from({ length: 32 }, (_, index) => ({ id: `new-${index}`, start_ms: index * 500,
  end_ms: index * 500 + (index === 30 ? 100 : 500), style_id: doc.styles[0].id,
  text: index === 10 ? '' : index === 20 ? '{\\pos(1,2)}不支持' : index === 29 ? '阅读速度很快'.repeat(5) : `字幕${index}` }));
let inspectCount = 0, delayNextInspection = false, rejectNextInspection = false;
let releaseInspection, inspectionStarted;
const inspectedDocuments = [];
const projectDocument = uiDocument();
projectDocument.cues = [{ id: 'new-project', start_ms: 1000, end_ms: 3000, text: '服务器原文', style_id: projectDocument.styles[0].id },
  { id: 'new-outside', start_ms: 19000, end_ms: 21000, text: '尾部字幕', style_id: projectDocument.styles[0].id }];
const mediaBytes = readFileSync(file);
const project = { id: 7, organization_id: 1, name: 'QC project', description: '', status: 'active', revision: 3,
  created_at: '2026-11-07T00:00:00Z', updated_at: '2026-11-07T00:00:00Z', updated_by: { username: 'qc' }, archived_at: null, archived_by: null,
  media: { size: mediaBytes.length, sha256: createHash('sha256').update(mediaBytes).digest('hex'), duration_ms: 20000 }, document: projectDocument };
const requests = [], errors = [], unexpected = [], checks = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
context.on('page', page => page.on('pageerror', error => errors.push(String(error))));
await context.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  requests.push(`${request.method()} ${path}`);
  if (path === '/api/ass/inspect') {
    inspectCount++;
    inspectedDocuments.push(request.postDataJSON().document);
    const result = codec('inspect', request.postDataJSON());
    if (delayNextInspection) {
      delayNextInspection = false;
      inspectionStarted?.();
      await new Promise(resolve => { releaseInspection = resolve; });
    }
    if (rejectNextInspection) {
      rejectNextInspection = false;
      return route.fulfill({ status: 503, json: { detail: 'fixture inspection failure' } });
    }
    return route.fulfill({ json: result.body });
  }
  if (path === '/api/ass/export') {
    const result = codec('export', request.postDataJSON());
    return result.status === 200 ? route.fulfill({ contentType: 'text/plain', body: result.body.text })
      : route.fulfill({ status: result.status, json: result.body });
  }
  const fixtures = {
    '/api/auth/session': { user: { id: 1, username: 'qc', is_dev: false } },
    '/api/organizations': { organizations: [{ id: 1, name: 'QC test', role: 'member', can_manage: false }] },
    '/api/me/settings': { handbook_seen: true, shortcut_overrides: {}, audio_display_mode: 'spectrum', mouse_sets_cue_boundary: true },
    '/api/ass/empty': { document: doc }, '/api/organizations/1/projects': { projects: [], total: 0, page: 1, has_more: false },
    '/api/organizations/1/projects/7': { project },
    '/api/organizations/1/projects/8': { project: { ...project, id: 8, status: 'archived' } },
  };
  if (fixtures[path]) return route.fulfill({ json: fixtures[path] });
  unexpected.push(`${request.method()} ${path}`); return route.abort();
});
const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('dialog', dialog => dialog.accept());
const origin = process.env.SUBTITLE_QC_URL || 'http://127.0.0.1:5211';
const qc = page.getByRole('button', { name: '字幕质量检查', exact: true });
const panel = page.getByRole('complementary', { name: '字幕质量检查' });
const text = page.getByLabel('字幕中文文本');
const start = page.getByRole('textbox', { name: '入点', exact: true });
const rows = page.locator('.cue-list tbody tr');
const rerun = async () => { await panel.getByRole('button', { name: '重新检查' }).click(); await page.waitForFunction(() => !document.querySelector('.qc-status')?.textContent.includes('正在检查')); };
const selected = () => page.locator('.row-number[aria-pressed="true"]').textContent();
const upperSize = () => page.evaluate(() => ['.workbench', '.video-stage', '.audio-timeline'].map(selector => {
  const r = document.querySelector(selector).getBoundingClientRect(); return { width: r.width, height: r.height };
}));
try {
  await page.goto(`${origin}/workspace/local`); await rows.first().waitFor();
  assert.equal(await panel.count(), 0); assert.equal(inspectCount, 0);
  await page.getByLabel('导入本地视频').setInputFiles(file);
  await page.waitForFunction(() => document.querySelector('video')?.duration === 20);
  const initialSizes = await upperSize();
  const tableHandle = await page.locator('.cue-list table').elementHandle();
  await qc.click(); await panel.locator('[data-qc-type="unsupported-ass"]').waitFor();
  const boxes = await Promise.all([page.locator('.cue-table-pane'), panel].map(el => el.boundingBox()));
  assert(Math.abs(boxes[0].y - boxes[1].y) < 1); assert(boxes[0].width >= 740);
  assert(boxes[1].width >= 320 && boxes[1].width <= 480);
  assert.deepEqual(await upperSize(), initialSizes);
  assert.equal(await panel.locator('[data-qc-type="empty-text"] .qc-severity').textContent(), '提示');
  await page.screenshot({ path: join(artifacts, 'qc-desktop.png') });
  checks.push(`desktop: QC ${Math.round(boxes[1].width)}px; table ${Math.round(boxes[0].width)}px; video/audio unchanged`);

  await panel.locator('[data-qc-type="unsupported-ass"]').click();
  assert.equal(await selected(), '21'); assert.equal(await text.inputValue(), '{\\pos(1,2)}不支持');
  assert(Math.abs(await page.locator('video').evaluate(v => v.currentTime) - 10) < .1);
  assert(await page.locator('video').evaluate(v => v.paused));
  assert(await rows.nth(20).evaluate(el => {
    const r = el.getBoundingClientRect(), container = el.closest('.table-scroll').getBoundingClientRect();
    return r.top >= container.top && r.bottom <= container.bottom;
  }));
  await text.fill('已修复');
  await page.getByText('字幕已修改，待重新检查。', { exact: true }).waitFor();
  assert.equal(await panel.locator('.qc-issue').count(), 0);
  await rerun(); assert.equal(await panel.locator('[data-qc-type="unsupported-ass"]').count(), 0);
  assert(inspectCount >= 2);
  await start.fill('0:');
  await panel.getByText(/存在未提交的时间输入/).waitFor();
  const beforeTimeDraft = inspectCount;
  await qc.click(); await qc.click();
  assert.equal(await start.inputValue(), '0:'); assert.equal(inspectCount, beforeTimeDraft);
  assert(await tableHandle.evaluate(table => table === document.querySelector('.cue-list table')));
  await panel.locator('[data-qc-type="high-cps"]').filter({ hasText: '第 30 行' }).click();
  assert.equal(await selected(), '30');
  await text.fill('已修复快读'); await rerun();
  checks.push('issue click selects/scolls/seeks; unsaved edits invalidate results; recheck updates; toggle preserves table instance and raw drafts');

  await page.getByRole('button', { name: '导出 ASS', exact: true }).click();
  await panel.getByText('导出前检查', { exact: true }).waitFor();
  assert.equal(await panel.locator('[data-qc-type="empty-text"] .qc-severity').textContent(), '警告');
  const downloaded = page.waitForEvent('download');
  await panel.getByRole('button', { name: '继续导出 ASS', exact: true }).click();
  const download = await downloaded, exported = readFileSync(await download.path(), 'utf8');
  assert(exported.includes('已修复快读')); assert(!exported.includes('pos(1,2)'));
  checks.push('export rechecks with export-phase empty warnings; warnings allow actual ASS download of unsaved text');

  // Late inspection must not revive a stale snapshot or trigger an export.
  delayNextInspection = true;
  const begun = new Promise(resolve => { inspectionStarted = resolve; });
  await panel.getByRole('button', { name: '重新检查' }).click(); await begun;
  await text.fill('新快照'); releaseInspection();
  await page.getByText('字幕已修改，待重新检查。', { exact: true }).waitFor();
  assert(await panel.getByRole('button', { name: '继续导出 ASS' }).isDisabled());
  await rerun();
  rejectNextInspection = true; await rerun();
  await panel.getByRole('alert').filter({ hasText: 'ASS 格式检查未完成' }).waitFor();
  assert(!(await panel.getByRole('button', { name: '继续导出 ASS' }).isDisabled()));
  await rerun();
  checks.push('late results are ignored; a failed format check is explicitly incomplete and does not impose a new export blocker');

  await text.fill('{\\k20}不支持'); await rerun();
  await panel.locator('[data-qc-type="unsupported-ass"]').waitFor();
  assert(await panel.getByRole('button', { name: '继续导出 ASS' }).isDisabled());
  await text.fill('新快照'); await rerun();
  await panel.getByRole('button', { name: '重新检查' }).focus(); await page.keyboard.press('Escape');
  assert.equal(await panel.count(), 0);
  await page.getByRole('button', { name: '查找字幕', exact: true }).click();
  const findInput = page.getByRole('textbox', { name: '查找字幕文本', exact: true });
  await findInput.fill('字幕'); await qc.click();
  assert.equal(await findInput.inputValue(), '字幕');
  await panel.getByText('字幕检查', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.qc-status')?.textContent.includes('提示 1'));
  await page.getByRole('button', { name: '导出 ASS', exact: true }).click();
  await panel.getByText('导出前检查', { exact: true }).waitFor();

  for (const viewport of [{ width: 1200, height: 768 }, { width: 1440, height: 600 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    assert(await panel.isVisible());
    if (viewport.width >= 1200) {
      const bounds = await page.locator('.cue-table-pane').boundingBox(); assert(bounds.width >= 740);
      const width = (await panel.boundingBox()).width; assert(width >= 320 && width <= 480);
      assert((await panel.locator('.qc-issues').boundingBox()).height >= 40);
    } else {
      assert(!(await page.locator('.cue-table-pane').isVisible()));
      await page.getByRole('button', { name: '查找字幕', exact: true }).focus(); await page.keyboard.press('Control+f');
      assert.equal(await panel.count(), 0); assert(await findInput.isVisible()); assert.equal(await findInput.inputValue(), '字幕');
      assert(await findInput.evaluate(input => input === document.activeElement));
      await qc.click();
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: join(artifacts, `qc-${viewport.width}x${viewport.height}.png`), fullPage: true });
  }
  checks.push('1200px, short 600px window, 1024px and 390px: correct split/switch, preserved search, no page overflow');

  await page.setViewportSize({ width: 1440, height: 900 });
  await qc.click();
  await text.fill('撤销测试'); await text.blur();
  await page.locator('main.editor-workbench').focus(); await page.keyboard.press('Meta+z');
  assert.equal(await text.inputValue(), '新快照');
  checks.push('QC close leaves ordinary editing and undo intact');

  const projectPage = await context.newPage();
  await projectPage.goto(`${origin}/organizations/1/projects/7/workspace`);
  const projectText = projectPage.getByLabel('字幕中文文本');
  const projectQc = projectPage.getByRole('button', { name: '字幕质量检查', exact: true });
  const projectPanel = projectPage.getByRole('complementary', { name: '字幕质量检查' });
  await projectPage.getByRole('button', { name: '选择第 1 行', exact: true }).click();
  assert(await projectText.isDisabled());
  await projectQc.click(); await projectPanel.locator('[data-qc-type="outside-video"]').waitFor();
  // Project media manifest supplies known duration even without a loaded video.
  assert.equal(inspectedDocuments.at(-1).cues[0].text, '服务器原文');
  await projectPage.getByLabel('导入本地视频').setInputFiles(file);
  await projectPage.waitForFunction(() => !document.querySelector('textarea')?.disabled);
  await projectText.fill('尚未保存的项目修改');
  await projectPanel.getByRole('button', { name: '重新检查' }).click();
  await projectPanel.locator('[data-qc-type="outside-video"]').waitFor();
  assert.equal(inspectedDocuments.at(-1).cues[0].text, '尚未保存的项目修改');
  assert(!requests.some(value => value.includes('/projects/7/document')));
  await projectPage.getByRole('button', { name: '重新加载项目', exact: true }).click();
  const guard = projectPage.getByRole('dialog'); await guard.waitFor();
  const beforeBackup = inspectCount, backup = projectPage.waitForEvent('download');
  await guard.getByRole('button', { name: '导出 ASS', exact: true }).click();
  const backupDownload = await backup;
  assert(readFileSync(await backupDownload.path(), 'utf8').includes('尚未保存的项目修改'));
  assert.equal(inspectCount, beforeBackup);
  await guard.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await projectText.inputValue(), '尚未保存的项目修改');
  await projectPage.close();
  const archived = await context.newPage();
  await archived.goto(`${origin}/organizations/1/projects/8/workspace`);
  await archived.getByRole('button', { name: '字幕质量检查', exact: true }).click();
  await archived.locator('[data-qc-type="outside-video"]').click();
  assert(await archived.getByLabel('字幕中文文本').isDisabled());
  await archived.close();
  checks.push('projects: QC works before video verification/when archived; uses unsaved in-memory edits without saving; guard backup download and cancel preserve the draft');

  const clean = await context.newPage(), cleanDocument = uiDocument();
  cleanDocument.cues = [{ id: 'new-clean', start_ms: 1000, end_ms: 3000, text: '正常字幕', style_id: cleanDocument.styles[0].id }];
  await clean.route('**/api/ass/empty', route => route.fulfill({ json: { document: cleanDocument } }));
  await clean.goto(`${origin}/workspace/local`);
  await clean.getByRole('button', { name: '选择第 1 行', exact: true }).waitFor();
  const direct = clean.waitForEvent('download');
  await clean.getByRole('button', { name: '导出 ASS', exact: true }).click();
  assert(readFileSync(await (await direct).path(), 'utf8').includes('正常字幕'));
  assert.equal(await clean.getByRole('complementary', { name: '字幕质量检查' }).count(), 0);
  await clean.close(); checks.push('clean export downloads directly without an extra panel or confirmation');

  const performance = await page.evaluate(async () => {
    const { checkSubtitles } = await import('/src/subtitle-qc/check-subtitles.ts');
    const sample = { schema_version: 2, source: '', script: {}, styles: [{ id: 's' }],
      cues: Array.from({ length: 5000 }, (_, index) => ({ id: `new-${index}`, start_ms: index * 2500, end_ms: index * 2500 + 2000, style_id: 's', text: `字幕${index}` })) };
    const durations = [];
    for (let run = 0; run < 5; run++) { const start = window.performance.now(); const issues = checkSubtitles(sample); durations.push(window.performance.now() - start); if (issues.length) throw Error('false positives'); }
    return durations;
  });
  const large = await context.newPage(), largeDocument = uiDocument();
  largeDocument.cues = Array.from({ length: 5000 }, (_, index) => ({ id: `new-${index}`, start_ms: index * 2500,
    end_ms: index * 2500 + 2000, style_id: largeDocument.styles[0].id, text: '' }));
  await large.route('**/api/ass/empty', route => route.fulfill({ json: { document: largeDocument } }));
  await large.goto(`${origin}/workspace/local`);
  await large.getByRole('button', { name: '选择第 5000 行', exact: true }).waitFor({ state: 'attached' });
  await large.evaluate(() => {
    window.qcLongTasks = [];
    window.qcPerformanceObserver = new PerformanceObserver(list => window.qcLongTasks.push(...list.getEntries().map(entry => entry.duration)));
    window.qcPerformanceObserver.observe({ type: 'longtask' });
  });
  const openStarted = Date.now();
  await large.getByRole('button', { name: '字幕质量检查', exact: true }).click();
  await large.locator('.qc-status').filter({ hasText: '提示 5000' }).waitFor();
  await large.locator('.qc-issue').last().waitFor({ state: 'attached' });
  const largeUi = { openMs: Date.now() - openStarted, longTasks: await large.evaluate(() => window.qcLongTasks) };
  assert.equal(await large.locator('.qc-issue').count(), 100);
  await large.getByRole('button', { name: '显示更多（剩余 4900 条）', exact: true }).click();
  assert.equal(await large.locator('.qc-issue').count(), 200);
  await large.close();
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  const result = { browser: browser.version(), checks, core5000Ms: performance, largeUi, inspectCount, errors, unexpected };
  writeFileSync(join(artifacts, 'report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ artifacts, ...result }, null, 2));
} finally { releaseInspection?.(); await browser.close(); }
