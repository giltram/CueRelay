// Existing UI-only fixtures do not own ASS rendering. Keep preview requests
// explicit and isolated; ass-preview.mjs exercises the real codec and WASM.
export async function unavailableAssPreview(route) {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith('/style-templates') && route.request().method() === 'GET') {
    await route.fulfill({ json: { templates: [] } }); return true;
  }
  if (path !== '/api/ass/export') return false;
  await route.fulfill({ status: 503, json: { issues: [{ message: 'UI fixture 未启动字幕转换服务' }] } });
  return true;
}
