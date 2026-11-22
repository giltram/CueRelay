// Same application flow with an explicitly selected driver for macOS's frozen test WebKit.
// Does not patch a driver, alter app capabilities, skip assertions or replace repository dependencies.
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { runPlatformFlow } from './application-flow.mjs';
import { server } from '../../scripts/browser-regression/vite-server.mjs';
let browser;
try {
  const driver = createRequire(import.meta.url)(process.env.CUERELAY_WEBKIT_DRIVER);
  browser = await driver.webkit.launch();
  console.log(JSON.stringify({ browser: browser.version(), driver: process.env.CUERELAY_WEBKIT_DRIVER, production: process.env.CUERELAY_E2E_PRODUCTION === '1' }));
  const errors = [];
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5199', locale: 'zh-CN', viewport: { width: 1440, height: 1000 } });
  context.on('page', page => page.on('pageerror', error => errors.push(String(error))));
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  try {
    await runPlatformFlow(await context.newPage(), browser, value => writeFile(`${process.env.CUERELAY_E2E_EVIDENCE}/capabilities.json`, JSON.stringify({ ...value, driver: process.env.CUERELAY_WEBKIT_DRIVER }, null, 2)));
    if (errors.length) throw new Error(JSON.stringify(errors));
    console.log('PASS frozen WebKit application flow');
  } finally { await context.tracing.stop({ path: `${process.env.CUERELAY_E2E_EVIDENCE}/trace.zip` }); }
} catch (error) { process.exitCode = 1; console.error(error); }
finally { await browser?.close(); await server.close(); }
