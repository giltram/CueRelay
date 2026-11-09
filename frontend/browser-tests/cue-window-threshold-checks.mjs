import assert from 'node:assert/strict';
import { uiDocument } from './ass-codec.mjs';

/** R3/R4: hand off the current reading row, including deletion of the anchor itself. */
export async function checkCueWindowThreshold(browser, origin) {
  const fixture = uiDocument();
  fixture.cues = Array.from({ length: 201 }, (_, index) => ({ id: `new-${index}`, start_ms: index * 3000,
    end_ms: index * 3000 + 2400, style_id: fixture.styles[0].id,
    text: `target${index + 1}end ` + '多行文本与换行测试\n'.repeat(4) }));
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = [], unexpected = [], snapshots = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('dialog', dialog => dialog.accept());
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const fixtures = {
      '/api/auth/session': { user: { id: 1, username: 'threshold-window', is_dev: false } },
      '/api/organizations': { organizations: [] },
      '/api/me/settings': { handbook_seen: true, shortcut_overrides: {}, audio_display_mode: 'spectrum' },
      '/api/ass/empty': { document: fixture },
    };
    if (fixtures[path]) return route.fulfill({ json: fixtures[path] });
    unexpected.push(path); return route.abort();
  });
  const main = page.locator('main.editor-workbench');
  async function snapshot(label) {
    await page.waitForTimeout(300);
    const result = await page.locator('.table-scroll').evaluate(container => {
      const top = container.querySelector('thead').getBoundingClientRect().bottom;
      const rows = [...container.querySelectorAll('tr[data-cue-id]')];
      const first = rows.find(row => row.getBoundingClientRect().bottom > top && row.getBoundingClientRect().top < container.getBoundingClientRect().bottom);
      return { first: first?.dataset.cueId, inset: first ? top - first.getBoundingClientRect().top : null,
        scrollTop: container.scrollTop, mounted: rows.length, windowed: container.hasAttribute('data-windowed') };
    });
    snapshots.push({ label, ...result });
    return result;
  }
  async function key(binding, count) {
    await main.focus(); await page.keyboard.press(binding);
    await page.locator(`.cue-list table[aria-rowcount="${count + 1}"]`).waitFor();
  }
  function sameReading(before, after, label) {
    assert.equal(after.first, before.first, `${label}: ${JSON.stringify({ before, after })}`);
    assert(Math.abs(after.inset - before.inset) <= 1, `${label}: ${JSON.stringify({ before, after })}`);
  }
  async function prepareAnchorDeletion(batch = false) {
    await page.reload();
    await page.getByRole('button', { name: '查找字幕', exact: true }).click();
    const input = page.getByRole('textbox', { name: '查找字幕文本', exact: true });
    await input.fill('target100end'); await input.press('Enter');
    await snapshot('search-anchor');
    if (batch) {
      for (const id of ['new-98', 'new-100', 'new-101']) {
        await page.locator(`tr[data-cue-id="${id}"] .row-number`).click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
      }
      assert.deepEqual(await page.locator('tr[aria-selected="true"]').evaluateAll(rows => rows.map(row => row.dataset.cueId)),
        ['new-98', 'new-99', 'new-100', 'new-101']);
    }
    // Make the deleted row the reading anchor, independently of the active selection.
    await page.locator('.table-scroll').evaluate(container => {
      const row = container.querySelector('[data-cue-id="new-99"]');
      const header = container.querySelector('thead');
      container.scrollTop += row.getBoundingClientRect().top - header.getBoundingClientRect().bottom + 20;
    });
    const before = await snapshot(batch ? 'before-batch-anchor-delete' : 'before-anchor-delete');
    assert.equal(before.first, 'new-99');
    assert(Math.abs(before.inset - 20) <= 1);
    return before;
  }
  try {
    await page.goto(`${origin}/workspace/local`);
    await page.getByRole('button', { name: '选择第 1 行', exact: true }).click();
    await page.locator('.table-scroll').evaluate(container => { container.scrollTop = 3000; });
    const beforeDelete = await snapshot('windowed-before-delete');
    await key('Control+Delete', 200);
    const afterDelete = await snapshot('native-after-delete');
    assert.equal(await page.locator('tr[data-cue-id]').count(), 200);
    await page.locator('.table-scroll').evaluate(container => { container.scrollTop = 1000; });
    const native = await snapshot('native-after-scroll');
    await key('Control+z', 201);
    const restored = await snapshot('windowed-after-undo');
    sameReading(native, restored, '201→200→scroll→undo');
    sameReading(beforeDelete, afterDelete, '201→200 delete');
    assert(restored.mounted < 100 && restored.windowed);
    // Repeated crossings must hand off both ways, including scrolling after each crossing.
    await page.locator('.table-scroll').evaluate(container => { container.scrollTop += 300; });
    const windowed = await snapshot('windowed-after-scroll');
    await key('Control+Shift+z', 200);
    const redone = await snapshot('native-after-redo');
    sameReading(windowed, redone, '201→200 redo');
    await page.locator('.table-scroll').evaluate(container => { container.scrollTop = 2000; });
    const nativeAgain = await snapshot('native-second-scroll');
    await key('Control+z', 201);
    sameReading(nativeAgain, await snapshot('windowed-second-undo'), 'second 200→201 undo');
    await key('Control+Shift+z', 200);
    await page.locator('.table-scroll').evaluate(container => { container.scrollTop = 0; });
    const nativeTop = await snapshot('native-at-top');
    await key('Control+z', 201);
    sameReading(nativeTop, await snapshot('windowed-undo-at-top'), '200→201 undo at top');

    // R4: the deleted ID itself must hand off to its surviving successor before DOM expansion.
    const beforeAnchorDelete = await prepareAnchorDeletion();
    await key('Control+Delete', 200);
    const afterAnchorDelete = await snapshot('native-after-anchor-delete');
    sameReading({ ...beforeAnchorDelete, first: 'new-100' }, afterAnchorDelete, 'deleted anchor→successor');
    assert.equal(afterAnchorDelete.windowed, false);
    await key('Control+z', 201);
    sameReading(afterAnchorDelete, await snapshot('windowed-anchor-delete-undo'), 'anchor deletion undo');
    await key('Control+Shift+z', 200);
    sameReading(afterAnchorDelete, await snapshot('native-anchor-delete-redo'), 'anchor deletion redo');

    const beforeBatchDelete = await prepareAnchorDeletion(true);
    await key('Control+Delete', 197);
    const afterBatchDelete = await snapshot('native-after-batch-anchor-delete');
    sameReading({ ...beforeBatchDelete, first: 'new-102' }, afterBatchDelete, 'batch deletion→first surviving successor');
    await key('Control+z', 201);
    sameReading(afterBatchDelete, await snapshot('windowed-batch-anchor-delete-undo'), 'batch anchor deletion undo');
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    return { thresholdUndo: true, bidirectionalHandoff: true, deletedAnchor: true, batchDeletedAnchor: true, snapshots };
  } finally { await page.close(); }
}
