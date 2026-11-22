import { expect, fixtures, rows, text, button } from './helpers.mjs';

export const start = page => page.getByRole('textbox', { name: '入点', exact: true });
export const selected = page => rows(page).and(page.locator('[aria-selected="true"]')).evaluateAll(rows => rows.map(row => row.dataset.cueId));
export function drafts(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('cuerelay-workspace-drafts', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction('drafts');
      const read = tx.objectStore('drafts').getAll();
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
      tx.oncomplete = () => db.close();
    };
  }));
}
export function writes(page, suffix) {
  const observed = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === `${fixtures.projectPath}/${suffix}` && request.method() !== 'GET') observed.push(request.postDataJSON());
  });
  return observed;
}
export async function localDraft(page, value, raw = '0:00:00.20') {
  await text(page).fill(value); await start(page).fill(raw);
  await expect.poll(() => drafts(page)).toMatchObject([{ baseRevision: 1,
    document: { cues: [{ text: value }] }, timing: { startText: raw } }]);
  return { records: await drafts(page), selection: await selected(page) };
}
export async function retained(page, before, value, raw = '0:00:00.20') {
  await expect(text(page)).toHaveValue(value); await expect(start(page)).toHaveValue(raw);
  expect(await selected(page)).toEqual(before.selection);
  expect(await drafts(page)).toEqual(before.records);
}
export async function reloadProject(page) {
  await button(page, '重新加载项目').click();
  await button(page.getByRole('dialog'), '明确放弃并继续').click();
  await expect.poll(() => drafts(page)).toEqual([]);
}
