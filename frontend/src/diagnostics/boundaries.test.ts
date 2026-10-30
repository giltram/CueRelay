import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('keeps diagnostics a leaf and frontend relative source dependencies acyclic', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  function sources(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? sources(path) : /\.(ts|tsx)$/.test(path) && !/\.test\./.test(path) ? [path] : [];
    });
  }
  const files = new Set(sources(root)), graph = new Map<string, string[]>();
  for (const file of files) {
    const edges: string[] = [];
    for (const match of readFileSync(file, 'utf8').matchAll(/(?:from\s+|import\s*\()['"](\.[^'"]+)/g)) {
      const base = resolve(dirname(file), match[1]);
      const target = [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts'), resolve(base, 'index.tsx')].find(path => files.has(path));
      if (target) edges.push(target);
    }
    graph.set(file, edges);
    if (file.startsWith(resolve(root, 'diagnostics') + '/')) expect(edges.every(edge => edge.startsWith(resolve(root, 'diagnostics') + '/')), file).toBe(true);
  }
  const visited = new Set<string>(), active = new Set<string>();
  function visit(file: string) {
    expect(active.has(file), `dependency cycle at ${file}`).toBe(false);
    if (visited.has(file)) return;
    active.add(file);
    for (const edge of graph.get(file) ?? []) visit(edge);
    active.delete(file); visited.add(file);
  }
  for (const file of files) visit(file);
});
