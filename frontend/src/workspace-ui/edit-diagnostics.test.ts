import { afterEach, expect, it, vi } from 'vitest';
import { EditDiagnostics } from './edit-diagnostics';
import { testScript, testStyle } from '../contracts/subtitles.test-fixtures';
import type { EditState } from './edit-history';
afterEach(() => vi.useRealTimers());
const state = (text: string): EditState => ({ document: { schema_version: 2, source: 'private source template', script: testScript, styles: [testStyle('style')], cues: [{ id: 'row', text, start_ms: 0, end_ms: 1000, style_id: 'style' }] }, selectedId: 'row', startText: '0:00:00.00', endText: '0:00:01.00' });
it('coalesces continuous input and flushes latest applied IME/paste text without changing state', () => {
  vi.useFakeTimers(); const emit = vi.fn(), observer = new EditDiagnostics(emit);
  const before = state(''), middle = state('中'), after = state('中文\\N粘贴');
  observer.observe(before, middle, 'input:row'); observer.observe(middle, after, 'input:row');
  expect(emit).not.toHaveBeenCalled(); observer.flush();
  const row = emit.mock.calls.find(call => call[2].cueId === 'row');
  expect(row?.[2].before.text).toBe(''); expect(row?.[2].after.text).toBe('中文\\N粘贴');
  expect(after.document?.cues[0].text).toBe('中文\\N粘贴');
  observer.flush(); expect(emit.mock.calls.filter(call => call[2].cueId === 'row')).toHaveLength(1);
});
it('records undo, delete and time drafts without source snapshots', () => {
  const emit = vi.fn(), observer = new EditDiagnostics(emit), before = state('before'), after = state('after');
  observer.observe(after, before, null, 'undo');
  expect(emit.mock.calls.some(call => call[0] === 'undo' && call[2].before.text === 'after')).toBe(true);
  observer.observe(before, { ...before, document: { ...before.document!, cues: [] }, endText: 'unfinished' }, null, 'delete');
  expect(emit.mock.calls.some(call => call[2].cueId === 'row' && !call[2].after)).toBe(true);
  expect(emit.mock.calls.some(call => call[2].draftAfter?.endText === 'unfinished')).toBe(true);
  expect(JSON.stringify(emit.mock.calls)).not.toContain('source');
});
