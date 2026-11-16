import assert from 'node:assert/strict';

/** Check the page boundary, then actual critical controls. Owned table/toolbars may scroll.
 * Do not classify every overflowing descendant as a defect: tables, inputs and virtual spacers
 * deliberately exceed their scrollports. Callers name the controls that must remain reachable.
 */
export async function checkLayout(page, { name, controls, surfaces = [] }) {
  const width = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
  assert(width.content <= width.width + 1, `${name}: unexpected page horizontal overflow ${JSON.stringify(width)}`);
  for (const selector of surfaces) {
    const element = page.locator(selector).first();
    if (!await element.isVisible()) continue;
    const rect = await element.boundingBox();
    assert(rect.width > 0 && rect.x >= -1 && rect.x + rect.width <= width.width + 1, `${name}: surface ${selector} leaves the page`);
  }
  for (const control of controls) {
    await control.scrollIntoViewIfNeeded();
    const result = await control.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const x = Math.max(0, Math.min(innerWidth - 1, rect.x + rect.width / 2));
      const y = Math.max(0, Math.min(innerHeight - 1, rect.y + rect.height / 2));
      const hit = document.elementFromPoint(x, y);
      return { label: element.textContent?.trim() || element.getAttribute('aria-label'),
        reachable: rect.width > 0 && rect.height > 0 && rect.left >= -1 && rect.right <= innerWidth + 1
          && rect.top >= -1 && rect.bottom <= innerHeight + 1 && (hit === element || element.contains(hit)),
        clipped: element.tagName === 'BUTTON' && (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) };
    });
    assert(result.reachable, `${name}: unreachable control ${JSON.stringify(result)}`);
    assert(!result.clipped, `${name}: clipped button text ${JSON.stringify(result)}`);
  }
  const body = await page.locator('body').innerText();
  assert(!/\{\{\s*\w+\s*\}\}|\b(?:workspaceUi|accountUi|projectUi|styleUi|glossaryUi|subtitleQc)\.[A-Za-z]/.test(body), `${name}: leaked key or interpolation`);
}

export async function screenshotLayout(page, path) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    // Scrolling the page intentionally dismisses a line menu. Preserve its actual open state.
    if (document.querySelector('[role=menu]')) return;
    window.scrollTo(0, 0);
    for (const element of document.querySelectorAll('.app-header, .style-detail, .style-list')) { element.scrollTop = 0; element.scrollLeft = 0; }
  });
  const hasMenu = await page.locator('[role=menu]').count() > 0;
  await page.screenshot({ path, fullPage: !hasMenu, animations: 'disabled', caret: 'hide' });
}
export const screenshotStyles = `
@font-face { font-family: LayoutAcceptance; src: url('/src/ass-preview/fonts/NotoSansSC-Regular.otf'); }
body, button, input, textarea, select, kbd, .time-display, .time-cell { font-family: LayoutAcceptance, sans-serif !important; }
*, *::before, *::after { animation: none !important; transition: none !important; }
`;
