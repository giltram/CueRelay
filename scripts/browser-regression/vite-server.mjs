import { createServer, preview } from '../../frontend/node_modules/vite/dist/node/index.js';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../../frontend');
const folder = process.env.CUERELAY_E2E_EVIDENCE;
const cacheDir = path.join(folder, 'vite-cache');
if (fs.existsSync(cacheDir)) throw new Error('Expected a new cold cache directory');
const record = (event, data = {}) => fs.appendFileSync(path.join(folder, 'vite-events.jsonl'), JSON.stringify({ event, ...data }) + '\n');
record('cold-cache', { cacheDir, existed: false });
const config = { root, configFile: path.join(root, 'vite.config.ts'), envFile: false, cacheDir,
  server: { host: '127.0.0.1', port: 5199, strictPort: true },
  preview: { host: '127.0.0.1', port: 5199, strictPort: true },
};
let server;
if (process.env.CUERELAY_E2E_SUITE === 'production' || process.env.CUERELAY_E2E_PRODUCTION === '1') {
  server = await preview(config);
} else {
  server = await createServer({ ...config, plugins: [{ name: 'regression-observer', configureServer(server) {
    const hot = server.environments.client.hot, send = hot.send.bind(hot);
    hot.send = (...args) => { record('hot-send', { args }); return send(...args); };
  } }] });
  await server.listen();
}
record('listening'); server.printUrls();
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
  if (server.close) await server.close(); else await new Promise(resolve => server.httpServer.close(resolve));
  process.exit(0);
});

export { server };
