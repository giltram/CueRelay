// Real browser regression for variable-height windowing; no database/media writes.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { uiDocument, codec } from './ass-codec.mjs';
import { sameTab } from './link-navigation.mjs';
import { checkMultilineWindow } from './cue-window-layout-checks.mjs';
import { checkCueWindowThreshold } from './cue-window-threshold-checks.mjs';

const documentFixture = uiDocument();
documentFixture.cues = Array.from({ length: 2000 }, (_, index) => ({ id: `new-${index}`, start_ms: index * 3000,
  end_ms: index * 3000 + 2400, style_id: documentFixture.styles[0].id,
  text: index === 1999 ? '末尾长字幕\n'.repeat(20)
    : index === 0 ? '共同查询 软换行文本 '.repeat(25) : `共同查询 字幕 ${index + 1}` })).reverse();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(10000);
const errors = [], unexpected = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('dialog', dialog => dialog.accept());
await page.route('**/api/**', route => {
  const path = new URL(route.request().url()).pathname;
  const fixtures = {
    '/api/auth/session': { user: { id: 1, username: 'window', is_dev: false } },
    '/api/organizations': { organizations: [] },
    '/api/me/settings': { handbook_seen: true, shortcut_overrides: {}, audio_display_mode: 'spectrum' },
    '/api/ass/empty': { document: documentFixture },
  };
  if (fixtures[path]) return route.fulfill({ json: fixtures[path] });
  if (path === '/api/ass/inspect') return route.fulfill({ json: { issues: [] } });
  if (path === '/api/ass/export') {
    const result = codec('export', route.request().postDataJSON());
    return route.fulfill({ status: result.status, contentType: result.status === 200 ? 'text/plain' : 'application/json',
      body: result.status === 200 ? result.body.text : JSON.stringify(result.body) });
  }
  unexpected.push(path); return route.abort();
});
const row = number => page.getByRole('button', { name: `选择第 ${number} 行`, exact: true });
const scroll = page.locator('.table-scroll'), text = page.getByLabel('字幕中文文本');
const main = page.locator('main.editor-workbench');
const mounted = () => page.locator('tr[data-cue-id]').count();
const visible = async number => assert(await row(number).evaluate(el => {
  const rect = el.closest('tr').getBoundingClientRect(), container = el.closest('.table-scroll').getBoundingClientRect();
  const header = el.closest('table').querySelector('thead').getBoundingClientRect().height;
  // Very tall rows may fill the window; their start must remain reachable.
  return rect.top >= container.top + header - 1 && rect.top < container.bottom && (rect.bottom <= container.bottom + 1 || rect.height > container.height - header);
}));
try {
  const threshold = await checkCueWindowThreshold(browser, process.env.CUE_WINDOW_URL || 'http://127.0.0.1:5173');
  const multiline = await checkMultilineWindow(browser, process.env.CUE_WINDOW_URL || 'http://127.0.0.1:5173');
  await page.goto(`${process.env.CUE_WINDOW_URL || 'http://127.0.0.1:5173'}/workspace/local`);
  await row(1).waitFor();
  assert(await mounted() < 100);
  assert.equal(await page.locator('.cue-list table').getAttribute('aria-rowcount'), '2001');
  await page.getByRole('button', { name: '查找字幕', exact: true }).click();
  const input = page.getByRole('textbox', { name: '查找字幕文本', exact: true });
  await input.fill('末尾长字幕'); await input.press('Enter');
  await row(2000).waitFor(); await visible(2000);
  assert.equal(await row(2000).getAttribute('aria-pressed'), 'true');
  assert.equal(await row(2000).evaluate(el => el.closest('tr').getAttribute('aria-rowindex')), '2001');
  assert(await mounted() < 100);
  await input.fill('共同查询'); await input.press('Enter'); // Wrap to first result.
  await row(1).waitFor(); await visible(1);
  await input.press('Shift+Enter'); await row(1999).waitFor(); await visible(1999);

  // Shift selection uses all data, including unmounted rows. Undo restores the full range.
  await input.fill('字幕 1'); await scroll.evaluate(el => { el.scrollTop = 0; }); await row(1).click();
  await input.fill('字幕 1999'); // Typing must not change selection.
  await scroll.evaluate(el => { el.scrollTop = el.scrollHeight; });
  await row(1999).click({ modifiers: ['Shift'] });
  await main.focus(); await page.keyboard.press('Control+Delete');
  await page.locator('.cue-list table[aria-rowcount="2"]').waitFor();
  assert.equal(await text.inputValue(), '末尾长字幕\n'.repeat(20));
  await page.keyboard.press('Control+z');
  await page.locator('.cue-list table[aria-rowcount="2001"]').waitFor();

  // Keyboard focus survives scrolling away; Tab mounts/focuses the adjacent data row.
  await input.fill('字幕 1000'); await input.press('Enter'); await row(1000).waitFor();
  await row(1000).locator('..').locator('..').locator('.cue-text').focus();
  await scroll.evaluate(el => { el.scrollTop = 0; }); await row(1).waitFor();
  assert(await row(1000).evaluate(el => el.closest('tr').contains(document.activeElement)));
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '选择第 1001 行');
  await page.keyboard.press('Shift+Tab');
  await page.waitForFunction(() => document.activeElement?.closest('tr')?.dataset.cueId === 'new-999' && document.activeElement.matches('.cue-text'));
  await page.keyboard.press('Shift+F10'); await page.getByRole('menu', { name: '字幕行操作' }).waitFor();
  await page.keyboard.press('Escape');

  // QC can reveal an offscreen row after changing table width; text wraps at native heights.
  await page.getByRole('button', { name: '字幕质量检查', exact: true }).click();
  const panel = page.getByRole('complementary', { name: '字幕质量检查' });
  await panel.locator('[data-qc-type="text-long"]').filter({ hasText: '第 2000 行' }).click();
  await row(2000).waitFor(); await visible(2000);
  await page.getByRole('button', { name: '字幕质量检查', exact: true }).click();
  // Editing timing can move a stable cue ID to another window; undo restores its row number.
  await text.fill('末尾长字幕\n'.repeat(22));
  await page.getByRole('textbox', { name: '入点', exact: true }).fill('0:00:00.10');
  await page.getByRole('textbox', { name: '出点', exact: true }).fill('0:00:01.00');
  await main.focus(); await page.keyboard.press('KeyG');
  await input.fill('末尾长字幕'); await input.press('Enter');
  await row(2).waitFor();
  assert.equal(await row(2).evaluate(el => el.closest('tr').dataset.cueId), 'new-1999');
  await visible(2);
  await main.focus(); await page.keyboard.press('Control+z');
  await input.focus(); await input.press('Enter'); await row(2000).waitFor(); await visible(2000);
  assert.equal(await row(2000).evaluate(el => el.closest('tr').dataset.cueId), 'new-1999');
  await input.fill('共同查询'); await input.press('Enter'); await row(1).waitFor();
  const wideHeight = await row(1).evaluate(el => el.closest('tr').getBoundingClientRect().height);
  const handle = page.getByRole('separator', { name: '调整style列宽度', exact: true });
  await handle.focus(); await page.keyboard.press('End');
  await page.setViewportSize({ width: 390, height: 900 });
  await input.fill('共同查询'); await input.press('Enter');
  // Forward/backward navigation returns to the first result after wrapping changes.
  await input.press('Shift+Enter'); await row(1).waitFor(); await visible(1);
  assert(await row(1).evaluate(el => el.closest('tr').getBoundingClientRect().height) > wideHeight);
  assert(await mounted() < 100);
  await sameTab(page.getByRole('link', { name: '项目列表', exact: true }));
  await main.waitFor({ state: 'hidden' }); await page.goBack(); await main.waitFor({ state: 'visible' });
  await visible(1);
  assert.equal(await input.inputValue(), '共同查询');
  assert.equal(await handle.getAttribute('aria-valuenow'), '320');
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log(JSON.stringify({ boundedRows: true, variableHeight: true, fullSearchAndSelection: true,
    undoAndReordering: true, offscreenFocusAndTab: true, menu: true, qcReveal: true, resizeAndRestore: true, multiline, threshold }));
} catch (error) {
  console.error(error);
  console.error(await page.evaluate(() => ({ rows: document.querySelector('.cue-list table')?.getAttribute('aria-rowcount'),
    selected: [...document.querySelectorAll('tr[aria-selected="true"]')].map(row => row.dataset.cueId),
    text: document.querySelector('textarea')?.value, scroll: document.querySelector('.table-scroll')?.scrollTop })).catch(() => null));
  process.exitCode = 1;
} finally {
  await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 3000))]);
  process.exit(process.exitCode || 0);
}
