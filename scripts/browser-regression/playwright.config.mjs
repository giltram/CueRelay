import config from '../../frontend/regression/playwright.config.mjs';
import path from 'node:path';
const suite = process.env.CUERELAY_E2E_SUITE;
export default { ...config,
  testDir: path.resolve(import.meta.dirname, suite === 'platform' || suite === 'media' || suite === 'production' || suite === 'specialists'
    ? '../../frontend/platform-tests' : '../../frontend/regression'),
  reporter: [['list'], ['json', { outputFile: path.join(process.env.CUERELAY_E2E_EVIDENCE, 'playwright.json') }]],
  use: { ...config.use, browserName: process.env.CUERELAY_E2E_BROWSER || 'chromium', trace: 'on' },
  webServer: { ...config.webServer, command: `node ${path.join(import.meta.dirname, 'vite-server.mjs')}`, stdout: 'pipe', stderr: 'pipe' },
};
