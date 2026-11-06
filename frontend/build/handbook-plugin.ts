import type { Plugin } from 'vite';
import { compileHandbook } from './handbook-markdown.ts';

/** The handbook is a generated JS module in dev and production, never a runtime fetch. */
export function handbookMarkdown(): Plugin {
  return {
    name: 'handbook-markdown',
    enforce: 'pre',
    transform(source, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/handbook-ui/handbook.md')) return;
      return { code: `export default ${JSON.stringify(compileHandbook(source))};`, map: null };
    },
  };
}
