import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { randomBytes } from 'node:crypto';

const nonce = randomBytes(18).toString('base64');
const headers = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  // Restrict the app and its workers to local resources, including user blobs.
  'Content-Security-Policy': `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' ws://127.0.0.1:5173; media-src blob:; font-src 'self' blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'`,
};

export default defineConfig({
  plugins: [react(), {
    name: 'local-resource-audit',
    configureServer(server) {
      if (process.env.CUERELAY_AUDIT !== '1') return;
      server.middlewares.use((request, _response, next) => {
        // Validation only: never log request bodies, subtitle text or file paths.
        console.info('[resource-audit]', request.method, request.url?.split('?')[0],
          request.headers['content-type'] || '-', request.headers['content-length'] || '0');
        next();
      });
    },
  }],
  html: { cspNonce: nonce },
  server: {
    port: 5173,
    strictPort: true,
    headers,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  preview: { port: 5173, strictPort: true, headers, proxy: { '/api': 'http://127.0.0.1:8000' } },
  worker: { format: 'es' },
  test: { environment: 'node', exclude: ['node_modules/**', 'dist/**', 'browser-tests/**'] },
});
