import { afterEach, expect, it, vi } from 'vitest';
import { diagnosticId } from './identifier';
afterEach(() => vi.unstubAllGlobals());
it('diagnostics can initialize even without secure-context crypto APIs', () => {
  vi.stubGlobal('crypto', undefined);
  expect(diagnosticId()).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
});
