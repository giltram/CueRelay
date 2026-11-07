import { execFileSync } from 'node:child_process';
import { createReadStream, readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function serveRelease(output: () => string) {
  return (request: IncomingMessage, response: ServerResponse, next: () => void) => {
    const url = request.url?.split('?')[0] ?? '';
    if (url === '/open-source') { response.writeHead(302, { Location: '/open-source/' }); response.end(); return; }
    if (!url.startsWith('/open-source/')) return next();
    let name: string;
    try { name = decodeURIComponent(url.slice('/open-source/'.length)) || 'index.html'; }
    catch { response.writeHead(400); response.end(); return; }
    if (name.includes('\0')) { response.writeHead(400); response.end(); return; }
    const directory = output();
    const path = resolve(directory, name);
    if (!path.startsWith(directory + sep)) { response.writeHead(403); response.end(); return; }
    const stream = createReadStream(path);
    response.setHeader('Content-Type', name.endsWith('.html') ? 'text/html; charset=utf-8'
      : name.endsWith('.json') ? 'application/json' : name.endsWith('.gz') ? 'application/gzip' : 'text/plain; charset=utf-8');
    stream.on('error', () => { response.writeHead(404); response.end(); });
    stream.pipe(response);
  };
}

/** Build-owned static notices and matching source; never imports application code. */
export function openSourceRelease(): Plugin {
  let directory: string | undefined;
  const cleanup = () => { if (directory) rmSync(directory, { recursive: true, force: true }); directory = undefined; };
  const prepare = () => {
    if (directory) return directory;
    const output = mkdtempSync(join(tmpdir(), 'cuerelay-open-source-'));
    try {
      execFileSync('python3', [join(root, 'scripts/prepare_open_source.py'), '--output', output], { cwd: root, stdio: 'pipe' });
      directory = output;
      return output;
    } catch (error) { rmSync(output, { recursive: true, force: true }); throw error; }
  };
  return {
    name: 'open-source-release',
    buildStart() { cleanup(); prepare(); },
    generateBundle() {
      const output = prepare();
      const emit = (path: string, relative = '') => {
        for (const entry of readdirSync(path, { withFileTypes: true })) {
          const name = relative + entry.name;
          if (entry.isDirectory()) emit(join(path, entry.name), name + '/');
          else this.emitFile({ type: 'asset', fileName: 'open-source/' + name, source: readFileSync(join(path, entry.name)) });
        }
      };
      emit(output);
    },
    configureServer(server) {
      server.httpServer?.once('close', cleanup);
      server.middlewares.use(serveRelease(prepare));
    },
    configurePreviewServer(server) {
      server.middlewares.use(serveRelease(() => resolve(server.config.root, server.config.build.outDir, 'open-source')));
    },
    closeBundle: cleanup,
  };
}
