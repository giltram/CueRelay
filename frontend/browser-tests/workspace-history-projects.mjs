import assert from 'node:assert/strict';
import { unavailableAssPreview } from './ass-preview-fixture.mjs';

export async function checkHistoryProjects(browser, file, { createHash, readFileSync, splitOnBackend, uiDocument }) {
  const bytes = readFileSync(file), document = uiDocument();
  document.cues = [{ id: 'new-initial', start_ms: 1000, end_ms: 8000, text: '', style_id: document.styles[0].id }];
  let project = { id: 1, organization_id: 1, name: 'History project', description: '', status: 'active', revision: 1,
    updated_at: '2026-10-30T00:00:00Z', created_at: '2026-10-30T00:00:00Z', updated_by: { username: 'history' }, archived_at: null, archived_by: null,
    media: { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, duration_ms: 20000 }, document };
  const other = { ...project, id: 2, name: 'Other project' };
  let failSplit = false;
  let actor = { id: 1, username: 'history', is_dev: false };
  const localDocument = { ...document, cues: [] };
  const writes = [], errors = [], unexpected = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/api/**', async route => {
    if (await unavailableAssPreview(route)) return;
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    if (method !== 'GET' && (path.endsWith('/document') || path.endsWith('/split'))) {
      const data = request.postDataJSON(); writes.push({ path, data });
      if (data.revision !== project.revision) return route.fulfill({ status: 409, json: { error: { code: 'project_conflict', message: 'wrong revision' } } });
      if (path.endsWith('/split')) {
        if (failSplit) { failSplit = false; return route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'split failure' } } }); }
        const { revision, ...split } = data;
        const result = splitOnBackend(split); assert.equal(result.status, 200);
        project = { ...project, revision: project.revision + 1, document: result.body.document };
        return route.fulfill({ json: { ...result.body, project } });
      }
      project = { ...project, revision: project.revision + 1, document: data.document };
      return route.fulfill({ json: { project } });
    }
    const fixtures = {
      '/api/auth/session': { user: actor },
      '/api/organizations': { organizations: [{ id: 1, name: 'History org', role: 'member', can_manage: false }, { id: 2, name: 'Other org', role: 'member', can_manage: false }] },
      '/api/ass/empty': { document: localDocument },
      '/api/organizations/2/projects': { projects: [], total: 0, page: 1, has_more: false },
      '/api/me/settings': { audio_display_mode: 'spectrum', mouse_sets_cue_boundary: true, shortcut_overrides: { 'split-text': ['Ctrl+KeyT'] } },
      '/api/organizations/1/projects/1': { project }, '/api/organizations/1/projects/2': { project: other },
      '/api/organizations/1/projects': { projects: [project, other], total: 2, page: 1, has_more: false },
    };
    if (fixtures[path]) return route.fulfill({ json: fixtures[path] });
    unexpected.push(`${method} ${path}`); await route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(String(error))); page.on('dialog', dialog => dialog.accept());
  const main = page.locator('main.editor-workbench'), text = page.getByLabel('字幕中文文本');
  const start = page.locator('input[aria-label="入点"]'), rows = page.locator('.cue-list tbody tr');
  const save = page.getByRole('button', { name: '保存项目', exact: true });
  async function select() { await page.getByRole('button', { name: '选择第 1 行', exact: true }).click(); }
  async function verify() { await page.getByLabel('导入本地视频').setInputFiles(file); await page.waitForFunction(() => !document.querySelector('.cue-editor fieldset')?.disabled); }
  async function undo() { await main.focus(); await page.keyboard.press('Control+z'); }
  async function redo() { await main.focus(); await page.keyboard.press('Control+Shift+z'); }
  async function saveNow() { await save.click(); await page.waitForFunction(() => !document.querySelector('.cue-editor fieldset')?.disabled && document.querySelector('.file-actions button.primary')?.disabled); }
  async function sameTab(name) { const link = page.getByRole('link', { name, exact: true }); await link.evaluate(el => el.target = '_self'); await link.click(); }
  try {
    await page.goto(new URL('/organizations/1/projects/1/workspace', process.env.HISTORY_URL || 'http://127.0.0.1:5189').href);
    await verify(); await select();
    await text.fill('saved text'); await saveNow(); assert.equal(project.revision, 2);
    const count = writes.length;
    await undo(); assert.equal(await text.inputValue(), ''); assert.equal(writes.length, count); assert.equal(await save.isEnabled(), true);
    await saveNow(); assert.equal(writes.at(-1).data.revision, 2); assert.equal(project.revision, 3); assert.equal(project.document.cues[0].text, '');
    await redo(); assert.equal(await text.inputValue(), 'saved text'); assert.equal(writes.length, count + 1);
    // Successful split persists once; undo/redo only replace local state.
    await text.fill('甲乙'); await text.focus(); await text.evaluate(el => el.setSelectionRange(1, 1)); await text.press('Control+t');
    await page.waitForFunction(() => document.querySelectorAll('.cue-list tbody tr').length === 2);
    assert.equal(project.revision, 4); const splitIds = project.document.cues.map(cue => cue.id), afterSplitWrites = writes.length;
    await undo(); assert.equal(await rows.count(), 1); assert.equal(await text.inputValue(), '甲乙'); assert.equal(writes.length, afterSplitWrites);
    assert.equal(await save.isEnabled(), true);
    await saveNow(); assert.equal(writes.at(-1).data.revision, 4); assert.equal(project.revision, 5); assert.equal(project.document.cues.length, 1);
    await redo(); assert.equal(await rows.count(), 2); assert.equal(writes.length, afterSplitWrites + 1);
    await saveNow(); assert.equal(writes.at(-1).data.revision, 5); assert.deepEqual(project.document.cues.map(cue => cue.id), splitIds);
    // Failure never advances CAS or consumes history.
    await text.fill('失败测试'); await text.focus(); await text.evaluate(el => el.setSelectionRange(1, 1));
    failSplit = true; await text.press('Control+t'); await page.getByRole('alert').filter({ hasText: 'split failure' }).waitFor();
    assert.equal(project.revision, 6); assert.equal(await text.inputValue(), '失败测试');
    await undo(); assert.equal(await text.inputValue(), '甲'); assert.equal(await rows.count(), 2);
    await redo(); assert.equal(await text.inputValue(), '失败测试');
    // Retained hidden instance ignores Z, then returns with its media/history.
    await start.fill('0:00:01.50'); await main.focus();
    const oldVideo = await page.locator('video').evaluate(el => { el.dataset.historyInstance = 'retained'; return el.currentTime; });
    await sameTab('项目列表'); await main.waitFor({ state: 'hidden' });
    await page.keyboard.press('Control+z'); assert.equal(await start.inputValue(), '0:00:01.50');
    await page.goBack(); await main.waitFor({ state: 'visible' });
    assert.equal(await page.locator('video').getAttribute('data-history-instance'), 'retained');
    await undo(); assert.equal(await start.inputValue(), '0:00:01.00');
    assert.equal(await page.locator('video').evaluate(el => el.currentTime), oldVideo);
    await redo(); assert.equal(await start.inputValue(), '0:00:01.50');
    // Reload uses the existing paused discard dialog and destroys history.
    await page.getByRole('button', { name: '重新加载项目', exact: true }).click();
    await page.getByRole('dialog').waitFor(); await page.keyboard.press('Control+z'); assert.equal(await start.inputValue(), '0:00:01.50');
    await page.getByRole('button', { name: '明确放弃并继续', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('video')?.dataset.historyInstance);
    await verify(); await select(); await undo(); assert.equal(await text.inputValue(), '甲'); assert.equal(await start.inputValue(), '0:00:01.00');
    // Replacing the project cannot carry old local snapshots across instances.
    await text.fill('discard me'); await sameTab('项目列表');
    await sameTab('Other project'); await page.getByRole('dialog').waitFor();
    await page.getByRole('button', { name: '明确放弃并继续', exact: true }).click();
    await page.waitForURL('**/projects/2/workspace'); await verify(); await select(); await undo();
    assert.equal(await text.inputValue(), ''); assert.equal(await rows.count(), 1);
    // Organization and approved account changes also replace the sole instance.
    await text.fill('old organization text'); await sameTab('项目列表');
    await page.getByLabel('当前组织', { exact: true }).selectOption('2');
    await page.getByRole('dialog').waitFor(); await page.getByRole('button', { name: '明确放弃并继续', exact: true }).click();
    await page.waitForURL('**/organizations/2/projects'); assert.equal(await main.count(), 0);
    await sameTab('本地工作区'); await rows.first().waitFor(); await undo(); assert.equal(await text.inputValue(), '');
    await text.fill('old account text');
    actor = { id: 2, username: 'next-account', is_dev: false };
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.getByRole('dialog', { name: '切换到账号 next-account' }).waitFor();
    await page.keyboard.press('Control+z'); assert.equal(await text.inputValue(), 'old account text');
    await page.getByRole('button', { name: '明确放弃并继续', exact: true }).click();
    await page.getByRole('link', { name: '本地工作区', exact: true }).waitFor();
    await sameTab('本地工作区'); await rows.first().waitFor(); await undo(); assert.equal(await text.inputValue(), '');
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    console.log('PASS project history: save/undo/save CAS, split success/failure, stable IDs, hidden retention, reload and project/organization/account replacement');
  } catch (error) { console.error('Project history state:', await page.locator('body').innerText()); throw error; }
  finally { await context.close(); }
}
