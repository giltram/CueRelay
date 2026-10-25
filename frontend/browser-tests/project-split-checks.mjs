import { unavailableAssPreview } from './ass-preview-fixture.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export async function checkProjectSplits(browser, file, emptyDocument, splitOnBackend) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const bytes = readFileSync(file);
  let project = {
    id: 1, organization_id: 1, name: '拆分快照夹具', description: '', status: 'active', revision: 1,
    created_at: '2026-10-24T00:00:00Z', updated_at: '2026-10-24T00:00:00Z', updated_by: { username: 'member' }, archived_by: null, archived_at: null,
    media: { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, duration_ms: 20000 },
    document: { ...emptyDocument, cues: [
      { id: 'new-empty', start_ms: 10000, end_ms: 16000, style_id: emptyDocument.styles[0].id, text: '' },
      { id: 'new-next', start_ms: 16000, end_ms: 18000, style_id: emptyDocument.styles[0].id, text: '后续保留' },
    ] },
  };
  const commands = [], errors = [], unexpected = [];
  await context.route('**/api/**', async route => {
    if (await unavailableAssPreview(route)) return;
    const request = route.request(), path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path.endsWith('/split')) {
      const { revision, ...split } = request.postDataJSON(); commands.push({ revision, ...split });
      if (revision !== project.revision) return route.fulfill({ status: 409, json: { error: { code: 'project_conflict', message: '项目已被其他操作更新，请刷新后重试；当前输入已保留。' } } });
      const result = splitOnBackend(split);
      if (result.status !== 200) return route.fulfill({ status: result.status, json: { error: { code: 'invalid_ass', message: result.body.issues[0].message } } });
      project = { ...project, revision: project.revision + 1, document: result.body.document };
      return route.fulfill({ json: { ...result.body, project } });
    }
    const fixtures = {
      '/api/auth/session': { user: { id: 1, username: 'member', is_dev: false } },
      '/api/organizations': { organizations: [{ id: 1, name: '组', role: 'member', can_manage: false }] },
      '/api/me/settings': { audio_display_mode: 'spectrum', mouse_sets_cue_boundary: true,
        shortcut_overrides: { 'split-playhead': ['Ctrl+KeyB'], 'split-text': ['Ctrl+KeyT'] } },
      '/api/organizations/1/projects/1': { project },
    };
    if (request.method() === 'GET' && fixtures[path]) return route.fulfill({ json: fixtures[path] });
    unexpected.push(`${request.method()} ${path}`); await route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  try {
    await page.goto(new URL('/organizations/1/projects/1/workspace', process.env.EDITING_URL || 'http://127.0.0.1:5189').href);
    await page.getByLabel('导入本地视频').setInputFiles(file);
    await page.waitForFunction(() => !document.querySelector('.cue-editor fieldset')?.disabled);
    await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
    await page.locator('video').evaluate(video => { video.currentTime = 13; });
    await page.locator('.audio-stage').focus(); await page.keyboard.press('Control+b');
    await page.waitForFunction(() => document.querySelectorAll('.cue-list tbody tr').length === 3);
    assert.equal(project.revision, 2);
    assert.equal(commands.length, 1); assert.equal(commands[0].revision, 1);
    assert.equal(await page.getByRole('button', { name: '保存项目', exact: true }).isDisabled(), true);
    assert.equal(project.document.cues[2].text, '后续保留');
    const remote = await context.newPage();
    await remote.goto(page.url());
    await remote.waitForFunction(() => document.querySelectorAll('.cue-list tbody tr').length === 3);
    assert((await remote.locator('.cue-list').innerText()).includes('后续保留'));
    await remote.close();
    // The next structural write must use the new revision, and includes local
    // text/timing drafts in one snapshot; it does not require a prior save click.
    const text = page.getByLabel('字幕中文文本');
    await text.fill('甲乙'); await text.evaluate(el => el.setSelectionRange(1, 1)); await text.press('Control+t');
    await page.waitForFunction(() => document.querySelectorAll('.cue-list tbody tr').length === 4);
    assert.equal(project.revision, 3); assert.equal(commands.at(-1).revision, 2);
    assert.deepEqual(project.document.cues.slice(0, 2).map(cue => cue.text), ['甲', '乙']);
    assert.equal(await page.getByRole('button', { name: '保存项目', exact: true }).isDisabled(), true);
    const before = await page.locator('.cue-list').innerText();
    // A later remote save invalidates this window's revision; no speculative
    // insertion or replacement of the local working copy may happen on 409.
    project = { ...project, revision: 4, document: { ...project.document, cues: project.document.cues.map((cue, i) => i === 3 ? { ...cue, text: '别人编辑' } : cue) } };
    await text.focus(); await text.evaluate(el => el.setSelectionRange(0, 0));
    // Use empty playhead split, avoiding a format rejection before the CAS check.
    await text.fill('');
    const localBefore = await page.locator('.cue-list').innerText();
    await page.locator('video').evaluate(video => { video.currentTime = 10.5; });
    await page.locator('.audio-stage').focus(); await page.keyboard.press('Control+b');
    await page.getByRole('alert').filter({ hasText: '项目已被其他操作更新' }).waitFor();
    assert.equal(await page.locator('.cue-list').innerText(), localBefore);
    assert.equal(await text.inputValue(), '');
    assert.equal(commands.at(-1).revision, 3); assert.equal(project.revision, 4);
    assert.equal(project.document.cues.length, 4);
    assert.equal(project.document.cues[3].text, '别人编辑');
    assert.notEqual(before, localBefore);
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    console.log('PASS project snapshot split: atomic response adoption, revision chaining, other-window reload and conflict preserves local draft');
  } finally { await context.close(); }
}
