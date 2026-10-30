import { expect, it } from 'vitest';
import { failureOutcome } from './errors';
it('separates cancellation, superseded requests, conflicts, unknown outcomes and faults', () => {
  expect(failureOutcome(new DOMException('cancel', 'AbortError'))).toBe('cancelled');
  expect(failureOutcome({ code: 'request_superseded' })).toBe('stale');
  expect(failureOutcome({ code: 'project_conflict' })).toBe('conflict');
  expect(failureOutcome({ code: 'response_unknown' })).toBe('unknown');
  expect(failureOutcome(Error())).toBe('error');
});
