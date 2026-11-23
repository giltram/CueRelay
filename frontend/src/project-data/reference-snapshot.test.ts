import { describe, expect, it } from 'vitest';
import { newestReference } from './reference-snapshot';

describe('reference snapshot acceptance within one resource lifetime', () => {
  const old = { version: 1, cues: [{ start_ms: 0, end_ms: 1000, text: 'old' }] };
  const replacement = { version: 2, cues: [{ start_ms: 0, end_ms: 1000, text: 'new' }] };
  const cleared = { version: 3, cues: null };

  it('accepts initialization, replacement and a newer clear', () => {
    expect(newestReference(undefined, old)).toBe(old);
    expect(newestReference(old, replacement)).toBe(replacement);
    expect(newestReference(replacement, cleared)).toBe(cleared);
  });

  it('never revives content or lowers the next CAS version on delayed or absent payloads', () => {
    expect(newestReference(replacement, old)).toBe(replacement);
    expect(newestReference(cleared, replacement)).toBe(cleared);
    expect(newestReference(cleared, undefined)).toBe(cleared);
    expect(newestReference(undefined, undefined)).toBeUndefined();
  });

  it('keeps the same-version object stable for scroll and native text selection', () => {
    expect(newestReference(replacement, structuredClone(replacement))).toBe(replacement);
    expect(newestReference(cleared, structuredClone(cleared))).toBe(cleared);
  });
});
