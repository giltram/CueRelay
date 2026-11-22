import { test, expect, fixtures, button, text, rows, openWorkspace, readProject, verifyVideo, saveDocument, settingsPath } from './helpers.mjs';
import { drafts, writes, localDraft, retained, reloadProject } from './failure-helpers.mjs';

// Fault injection affects delivery only. Every successful write reaches real HTTP/PostgreSQL.
async function loseCommittedResponse(page, suffix, readFrom) {
  const done = Promise.withResolvers();
  await page.route(`**${fixtures.projectPath}/${suffix}`, async route => {
    try {
      const response = await route.fetch({ maxRetries: 0 });
      expect(response.status()).toBe(200);
      const result = await response.json();
      const stored = await readProject(readFrom);
      expect(stored.revision).toBe(2);
      expect(stored.document).toEqual(result.document ?? result.project.document);
      await route.abort('failed'); done.resolve(stored);
    } catch (error) { done.reject(error); await route.abort(); }
  }, { times: 1 });
  return done;
}

test('split committed response loss retains local baseline and explicitly reloads', async ({ page }) => {
  await openWorkspace(page);
  const initial = await readProject(page);
  const value = '拆分本机正文';
  const before = await localDraft(page, value);
  const observed = writes(page, 'split');
  const done = await loseCommittedResponse(page, 'split', page);
  await text(page).focus(); await text(page).evaluate(el => el.setSelectionRange(2, 2));
  await page.keyboard.press('Control+t');
  const stored = await done.promise;
  await expect(page.getByRole('alert')).toContainText('操作结果未知');
  await expect(rows(page)).toHaveCount(1);
  await retained(page, before, value);
  expect(observed).toHaveLength(1); expect(observed[0].revision).toBe(1);
  expect(stored.document.cues.map(cue => cue.text)).toEqual(['拆分', '本机正文']);
  expect(stored.document.cues[0].start_ms).toBe(200);
  expect(initial.document.cues[0].start_ms).toBe(0);

  // A deliberate second command uses the old revision and fails; no automatic replay.
  const conflict = page.waitForResponse(r => r.url().endsWith('/split') && r.status() === 409);
  await text(page).focus(); await text(page).evaluate(el => el.setSelectionRange(2, 2));
  await page.keyboard.press('Control+t'); expect((await conflict).status()).toBe(409);
  await expect(page.getByRole('alert')).toContainText('当前输入已保留');
  await retained(page, before, value);
  expect(observed.map(body => body.revision)).toEqual([1, 1]);
  expect(await readProject(page)).toEqual(stored);
  await reloadProject(page); await verifyVideo(page);
  await expect(rows(page)).toHaveCount(2);
  await text(page).fill('拆分恢复后保存');
  const recovered = await saveDocument(page, 2);
  expect(recovered.document.cues.map(cue => cue.id)).toEqual(stored.document.cues.map(cue => cue.id));
  expect(recovered.document.cues.map(cue => cue.text)).toEqual(['拆分恢复后保存', '本机正文']);
  await expect.poll(() => drafts(page)).toEqual([]);
});

test('styles committed response loss preserves form and independent workspace draft', async ({ page, context }) => {
  await openWorkspace(page);
  const initial = await readProject(page);
  const before = await localDraft(page, '样式写入时工作台未保存', '0:00:');
  const tab = await context.newPage(); await tab.goto(settingsPath);
  await button(tab, '管理项目样式').click();
  const manager = tab.getByRole('dialog', { name: '项目样式管理', exact: true });
  const font = manager.getByRole('spinbutton', { name: '字号', exact: true });
  const observed = writes(tab, 'styles');
  await font.fill('61');
  const done = await loseCommittedResponse(tab, 'styles', page);
  await button(manager, '应用并保存').click();
  const stored = await done.promise;
  await expect(manager.getByRole('alert')).toContainText('操作结果未知');
  await expect(font).toHaveValue('61');
  await expect(manager.getByText('项目样式已保存。', { exact: true })).toHaveCount(0);
  await retained(page, before, '样式写入时工作台未保存', '0:00:');
  expect(stored.document.cues).toEqual(initial.document.cues);
  expect(stored.document.styles[0].fields.Fontsize).toBe('61');
  expect(observed.map(body => body.revision)).toEqual([1]);
  await font.fill('62');
  const conflict = tab.waitForResponse(r => r.url().endsWith('/styles') && r.status() === 409);
  await button(manager, '应用并保存').click(); await conflict;
  await expect(manager.getByRole('alert')).toContainText('当前输入已保留');
  await expect(font).toHaveValue('62');
  expect(observed.map(body => body.revision)).toEqual([1, 1]);
  expect(await readProject(page)).toEqual(stored);
  await button(manager, '关闭').click(); await button(tab, '管理项目样式').click();
  await expect(font).toHaveValue('61'); await font.fill('63');
  const saved = tab.waitForResponse(r => r.url().endsWith('/styles') && r.status() === 200);
  await button(manager, '应用并保存').click(); await saved;
  await expect(manager.getByText('项目样式已保存。', { exact: true })).toBeVisible();
  expect(observed.map(body => body.revision)).toEqual([1, 1, 2]);
  await retained(page, before, '样式写入时工作台未保存', '0:00:');
  const final = await readProject(page); expect(final.revision).toBe(3);
  expect(final.document.styles[0].fields.Fontsize).toBe('63');
  expect(final.document.cues).toEqual(initial.document.cues);
});
