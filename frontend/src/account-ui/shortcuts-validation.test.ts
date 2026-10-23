import { describe, expect, it } from 'vitest';
import { validateOverrides, type ShortcutOverrides } from '../workspace-ui/timing-shortcuts';

describe('shortcut validation', () => {
  it.each([
    { unknown: [] }, { commit: ['KeyS'] }, { commit: ['KeyT', 'KeyT'] },
    { commit: ['Ctrl+KeyL'] }, { commit: ['Meta+KeyQ'] }, { commit: ['Alt+KeyT'] },
    { commit: ['Shift+Space'] }, { commit: ['Escape'] }, { commit: ['F5'] },
  ])('rejects unknown, reserved and conflicting bindings: %j', value => {
    expect(validateOverrides(value as ShortcutOverrides)).toBeTruthy();
  });
  it('allows disabled actions, defaults, and explicit shift combinations', () => {
    for (const value of [{}, { commit: [] }, { commit: ['Shift+KeyT', 'KeyT'] }]) expect(validateOverrides(value)).toBeUndefined();
  });
});
