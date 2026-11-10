import assert from 'node:assert/strict';
import { uiDocument } from './ass-codec.mjs';

/** DOM regressions beyond the 201→200 threshold cases. */
export async function checkCueWindowDeletion(browser, origin) {
  const fixture = uiDocument();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [], unexpected = [], snapshots = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('dialog', dialog => dialog.accept());
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const fixtures = {
      '/api/auth/session': { user: { id: 1, username: 'deletion-window', is_dev: false } },
      '/api/organizations': { organizations: [] },
      '/api/me/settings': { handbook_seen: true, shortcut_overrides: {}, audio_display_mode: 'spectrum' },
      '/api/ass/empty': { document: fixture },
    };
    if (fixtures[path]) return route.fulfill({ json: fixtures[path] });
    unexpected.push(path); return route.abort();
  });
  async function snapshot(label) {
    await page.waitForTimeout(350);
    const value = await page.locator('.table-scroll').evaluate(container => {
      const header = container.querySelector('thead').getBoundingClientRect().bottom;
      const bottom = container.getBoundingClientRect().bottom;
      const rows = [...container.querySelectorAll('tr[data-cue-id]')];
      const visible = rows.filter(row => { const r = row.getBoundingClientRect(); return r.bottom > header && r.top < bottom; });
      const first = visible[0], last = visible.at(-1);
      return { first: first?.dataset.cueId, inset: first ? header - first.getBoundingClientRect().top : null,
        height: first?.getBoundingClientRect().height, last: last?.dataset.cueId,
        bottomGap: last ? bottom - last.getBoundingClientRect().bottom : null,
        maxScroll: container.scrollHeight - container.clientHeight, scrollTop: container.scrollTop,
        mounted: rows.length, windowed: container.hasAttribute('data-windowed') };
    });
    snapshots.push({ label, ...value });
    assert(value.windowed && value.mounted < 100, JSON.stringify(value));
    return value;
  }
  async function prepare({ short = false, tail = false } = {}) {
    fixture.cues = Array.from({ length: 401 }, (_, index) => ({ id: `new-${index}`, start_ms: index * 3000,
      end_ms: index * 3000 + 2400, style_id: fixture.styles[0].id,
      text: `target${index + 1}end ` + '多行文本与换行测试\n'.repeat(short && index === 100 ? 0 : tail && index >= 399 ? 40 : 4) }));
    await page.goto(`${origin}/workspace/local`);
    await page.getByRole('button', { name: '查找字幕', exact: true }).click();
    const input = page.getByRole('textbox', { name: '查找字幕文本', exact: true });
    const index = tail ? 399 : 99, inset = short ? 70 : 20;
    await input.fill(`target${index + 1}end`); await input.press('Enter');
    await page.waitForTimeout(350);
    if (tail) {
      await page.locator('tr[data-cue-id="new-400"] .row-number').click({ modifiers: ['Shift'] });
      assert.equal(await page.locator('tr[aria-selected="true"]').count(), 2);
    }
    await page.locator('.table-scroll').evaluate((container, { index, inset }) => {
      const row = container.querySelector(`[data-cue-id="new-${index}"]`);
      container.scrollTop += row.getBoundingClientRect().top - container.querySelector('thead').getBoundingClientRect().bottom + inset;
    }, { index, inset });
    const before = await snapshot('before-delete');
    assert.equal(before.first, `new-${index}`);
    assert(Math.abs(before.inset - inset) <= 1, JSON.stringify(before));
    return before;
  }
  async function key(binding, count) {
    await page.locator('main.editor-workbench').focus(); await page.keyboard.press(binding);
    await page.locator(`.cue-list table[aria-rowcount="${count + 1}"]`).waitFor();
  }
  function sameReading(expected, actual) {
    assert.equal(actual.first, expected.first, JSON.stringify({ expected, actual }));
    assert(Math.abs(actual.inset - expected.inset) <= 1, JSON.stringify({ expected, actual }));
  }
  try {
    const before = await prepare();
    await key('Control+Delete', 400);
    const deleted = await snapshot('windowed-successor');
    sameReading({ ...before, first: 'new-100' }, deleted);
    await key('Control+z', 401);
    sameReading(deleted, await snapshot('windowed-undo'));
    await key('Control+Shift+z', 400);
    sameReading(deleted, await snapshot('windowed-redo'));

    const tall = await prepare({ short: true });
    await key('Control+Delete', 400);
    const short = await snapshot('short-successor-clamped');
    assert(short.height < tall.inset, JSON.stringify({ tall, short }));
    sameReading({ first: 'new-100', inset: short.height - 1 }, short);
    assert.notEqual(short.last, short.first, 'adjacent content must remain visible');
    await key('Control+z', 401);
    sameReading(short, await snapshot('short-successor-undo'));
    await key('Control+Shift+z', 400);
    sameReading(short, await snapshot('short-successor-redo'));

    await prepare({ tail: true });
    await key('Control+Delete', 399);
    const tail = await snapshot('predecessor-at-scroll-limit');
    assert.equal(tail.last, 'new-398');
    assert(Math.abs(tail.scrollTop - tail.maxScroll) <= 1, JSON.stringify(tail));
    assert(Math.abs(tail.bottomGap) <= 2, JSON.stringify(tail));
    await key('Control+z', 401);
    sameReading(tail, await snapshot('predecessor-undo'));
    await key('Control+Shift+z', 399);
    sameReading(tail, await snapshot('predecessor-redo'));
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    return { windowedDeletion: true, shortSuccessor: true, predecessorClamp: true, snapshots };
  } finally { await page.close(); }
}
