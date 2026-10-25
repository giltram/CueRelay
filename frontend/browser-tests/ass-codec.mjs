import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const python = fileURLToPath(new URL('../../.venv/bin/python', import.meta.url));
const bridge = fileURLToPath(new URL('../../backend/browser_tests/ass_codec.py', import.meta.url));
export function codec(action, data = {}) {
  return JSON.parse(execFileSync(python, [bridge], { input: JSON.stringify({ action, data }), encoding: 'utf8' }));
}
export function uiDocument(names = ['Default']) {
  const result = codec('ui_fixture', { names });
  if (result.status !== 200) throw new Error(JSON.stringify(result));
  return result.body.document;
}
