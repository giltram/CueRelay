import { defineConfig } from 'playwright/test';
import { fileURLToPath } from 'node:url';

if (!process.env.CUERELAY_REGRESSION_FIXTURES || !process.env.CUERELAY_API_TARGET?.match(/^http:\/\/localhost:\d+$|^http:\/\/127\.0\.0\.1:\d+$/)) {
  throw new Error('Run through Django browser_tests.regression with application.test_settings');
}

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60000,
  expect: { timeout: 10000 },
  outputDir: '../test-results',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5199',
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5199 --strictPort',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: false,
    timeout: 180000,
  },
});
