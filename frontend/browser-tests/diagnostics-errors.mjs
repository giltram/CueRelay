// Real ProjectSettingsPage catch paths with delayed HTTP failures; no database writes.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { uiDocument } from './ass-codec.mjs';

const origin = process.env.DIAGNOSTICS_URL || 'http://127.0.0.1:5194';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const organizations = [1, 2].map(id => ({ id, name: `org-${id}`, role: 'organizer', can_manage: true }));
const project = { id: 7, organization_id: 1, name: 'fixture', description: '', status: 'active', revision: 3,
  media: { size: 100, sha256: 'a'.repeat(64), duration_ms: 4000 }, document: uiDocument(['Default']) };

try {
  for (const change of ['organization', 'account']) {
    const context = await browser.newContext();
    context.setDefaultTimeout(10000);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    let user = { id: 1, username: 'first', is_dev: false }, held;
    let started;
    const pending = new Promise(resolve => { started = resolve; });
    await context.route('**/api/**', route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (request.method() === 'PATCH' && path === '/api/organizations/1/projects/7') {
        held = route; started(); return;
      }
      const fixtures = {
        '/api/auth/session': { user }, '/api/organizations': { organizations },
        '/api/me/settings': { audio_display_mode: 'spectrum', shortcut_overrides: {}, mouse_sets_cue_boundary: true },
        '/api/organizations/1/projects/7': { project },
        '/api/organizations/1/projects': { projects: [], total: 0, page: 1, has_more: false },
        '/api/organizations/2/projects': { projects: [], total: 0, page: 1, has_more: false },
      };
      assert.ok(fixtures[path], `unexpected HTTP ${path}`);
      return route.fulfill({ json: fixtures[path] });
    });
    await page.goto(`${origin}/organizations/1/projects/7/settings`);
    await page.getByLabel('项目名称', { exact: true }).fill('delayed save');
    const startScope = await page.evaluate(async () => {
      const { diagnostics } = await import('/src/diagnostics/index.ts');
      const record = diagnostics.record.bind(diagnostics);
      // Observe completion of the actual component catch even after it unmounts.
      window.handledFailures = [];
      diagnostics.record = (...args) => {
        if (args[0] === 'project-ui' && args[1] === 'handled_error') window.handledFailures.push({ scope: args[4], context: args[5] });
        return record(...args);
      };
      return diagnostics.scope();
    });
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await pending;
    const requestId = held.request().headers()['x-request-id'];
    if (change === 'organization') {
      await page.getByRole('link', { name: 'CueRelay', exact: true }).click();
      await page.getByLabel('当前组织', { exact: true }).selectOption('2');
      await page.waitForFunction(async () => (await import('/src/diagnostics/index.ts')).diagnostics.contextSnapshot().organizationId === 2);
    } else {
      user = { id: 2, username: 'second', is_dev: false };
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await page.getByRole('dialog', { name: '切换到账号 second', exact: true }).waitFor();
      await page.waitForFunction(async previous => (await import('/src/diagnostics/index.ts')).diagnostics.scope() !== previous, startScope);
    }
    await held.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'delayed fixture failure' } } });
    await page.waitForFunction(() => window.handledFailures.length === 1);
    assert.deepEqual(await page.evaluate(() => window.handledFailures), [{ scope: startScope,
      context: { page: 'project-settings', organizationId: 1, projectId: 7 } }]);
    const collect = () => page.evaluate(async () => (await import('/src/diagnostics/index.ts')).diagnostics.collect());
    let result = await collect();
    assert.ok(!result.events.some(event => event.module === 'project-ui' && event.action === 'handled_error'));
    if (change === 'organization') {
      await page.getByLabel('当前组织', { exact: true }).selectOption('1');
      await page.waitForFunction(async () => (await import('/src/diagnostics/index.ts')).diagnostics.contextSnapshot().organizationId === 1);
      result = await collect();
      const failure = result.events.find(event => event.module === 'project-ui' && event.action === 'handled_error');
      assert.equal(failure?.data.requestId, requestId);
      assert.deepEqual(failure?.context, { page: 'project-settings', organizationId: 1, projectId: 7 });
    } else {
      assert.ok(!result.events.some(event => event.data.requestId === requestId));
    }
    assert.deepEqual(errors, []);
    console.log(`PASS delayed project save failure after ${change} switch`);
    await context.close();
  }
} finally { await browser.close(); }
