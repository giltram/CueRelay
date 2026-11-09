import assert from 'node:assert/strict';
import { uiDocument } from './ass-codec.mjs';
import { sameTab } from './link-navigation.mjs';

async function position(page, id) {
  return page.locator('.table-scroll').evaluate((container, id) => {
    const header = container.querySelector('thead').getBoundingClientRect();
    const bottom = container.getBoundingClientRect().bottom;
    const rows = [...container.querySelectorAll('tr[data-cue-id]')];
    const first = rows.find(row => row.getBoundingClientRect().bottom > header.bottom && row.getBoundingClientRect().top < bottom);
    const target = rows.find(row => row.dataset.cueId === id)?.getBoundingClientRect();
    return { first: first?.dataset.cueId, inset: first ? header.bottom - first.getBoundingClientRect().top : null,
      height: first?.getBoundingClientRect().height,
      targetVisible: Boolean(target && target.top >= header.bottom - 1 && target.top < bottom
        && (target.bottom <= bottom + 1 || target.height > bottom - header.bottom)),
      mounted: rows.length, scrollTop: container.scrollTop };
  }, id);
}

/** R1/R2: every row is tall, so each new window changes the cumulative offsets. */
export async function checkMultilineWindow(browser, origin) {
  const fixture = uiDocument();
  fixture.cues = Array.from({ length: 2000 }, (_, index) => ({ id: `new-${index}`, start_ms: index * 3000,
    end_ms: index * 3000 + 2400, style_id: fixture.styles[0].id,
    text: `target${index + 1}end ` + '多行文本与换行测试\n'.repeat(4) }));
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(10000);
  const errors = [], unexpected = [], failures = [], snapshots = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('dialog', dialog => dialog.accept());
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const fixtures = {
      '/api/auth/session': { user: { id: 1, username: 'multiline-window', is_dev: false } },
      '/api/organizations': { organizations: [] },
      '/api/me/settings': { handbook_seen: true, shortcut_overrides: {}, audio_display_mode: 'spectrum' },
      '/api/ass/empty': { document: fixture },
      '/api/ass/inspect': { issues: [{ type: 'unsupported-ass', cue_id: 'new-1499', message: '定位回归夹具' }] },
    };
    if (fixtures[path]) return route.fulfill({ json: fixtures[path] });
    unexpected.push(path); return route.abort();
  });
  async function targetVisible(number, label) {
    // Assert after all ResizeObserver-driven commits, not just the first mount.
    await page.waitForTimeout(450);
    const current = await position(page, `new-${number - 1}`);
    snapshots.push({ label, ...current });
    if (!current.targetVisible) failures.push(`${label}: target ${number} is outside the stable viewport`);
    assert(current.mounted < 100, `unbounded window: ${current.mounted}`);
  }
  async function keepsAnchor(action, label) {
    const before = await position(page);
    await action(); await page.waitForTimeout(450);
    const after = await position(page);
    snapshots.push({ label, before, after });
    const expectedInset = Math.min(before.inset, after.height - 1);
    if (before.first !== after.first || Math.abs(expectedInset - after.inset) > 1) failures.push(`${label}: ${JSON.stringify({ before, after })}`);
  }
  try {
    await page.goto(`${origin}/workspace/local`);
    await page.getByRole('button', { name: '选择第 1 行', exact: true }).waitFor();
    await page.getByRole('button', { name: '查找字幕', exact: true }).click();
    const input = page.getByRole('textbox', { name: '查找字幕文本', exact: true });
    for (const number of [1000, 1500, 400]) {
      await input.fill(`target${number}end`); await input.press('Enter');
      await targetVisible(number, `search-${number}`);
    }
    await page.getByRole('button', { name: '字幕质量检查', exact: true }).click();
    await page.locator('[data-qc-type="unsupported-ass"]').click();
    await targetVisible(1500, 'QC-1500');
    await page.getByRole('button', { name: '字幕质量检查', exact: true }).click();
    await page.waitForTimeout(300);
    // R2 is independent of search: choose a reading position by scrolling directly.
    await page.locator('.table-scroll').evaluate(container => { container.scrollTop = 30000; });
    await page.waitForTimeout(450);
    await keepsAnchor(async () => {
      await sameTab(page.getByRole('link', { name: '项目列表', exact: true }));
      await page.locator('main.editor-workbench').waitFor({ state: 'hidden' });
      await page.waitForTimeout(150);
      await page.goBack(); await page.locator('main.editor-workbench').waitFor({ state: 'visible' });
    }, 'hide-restore');
    await keepsAnchor(() => page.setViewportSize({ width: 1300, height: 900 }), 'resize');
    await keepsAnchor(async () => {
      const handle = page.getByRole('separator', { name: '调整style列宽度', exact: true });
      await handle.focus(); await page.keyboard.press('End');
    }, 'column-width');
    // On narrow layouts the table is hidden while QC is open; reveal must survive until it returns.
    await page.setViewportSize({ width: 800, height: 900 });
    const qc = page.getByRole('button', { name: '字幕质量检查', exact: true });
    await qc.click(); await page.locator('.cue-table-pane').waitFor({ state: 'hidden' });
    await page.locator('[data-qc-type="unsupported-ass"]').click();
    await qc.click(); await page.locator('.cue-table-pane').waitFor({ state: 'visible' });
    await targetVisible(1500, 'narrow-QC-1500');
    await page.setViewportSize({ width: 1300, height: 900 });
    // Now make width changes alter actual wrapping heights, not just invalidate equal heights.
    fixture.cues = fixture.cues.map(cue => ({ ...cue, text: cue.text + '软换行文本'.repeat(50) }));
    await page.reload();
    await page.getByRole('button', { name: '选择第 1 行', exact: true }).waitFor();
    await page.locator('.table-scroll').evaluate(container => { container.scrollTop = 30000; });
    await page.waitForTimeout(450);
    await keepsAnchor(() => page.setViewportSize({ width: 1100, height: 900 }), 'soft-wrap-narrow');
    await keepsAnchor(() => page.setViewportSize({ width: 1440, height: 900 }), 'soft-wrap-wide');
    await keepsAnchor(() => qc.click(), 'soft-wrap-QC-open');
    await keepsAnchor(() => qc.click(), 'soft-wrap-QC-close');
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
    assert.deepEqual(failures, [], JSON.stringify(snapshots, null, 2));
    return { continuousMultilineSearch: true, qc: true, middleRestore: true, resizeAnchor: true, snapshots };
  } finally { await page.close(); }
}
