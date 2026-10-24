import { describe, expect, it } from 'vitest';
import { shortcutDefaults, validateOverrides, type ShortcutOverrides } from '../workspace-ui/timing-shortcuts';

describe('shortcut validation', () => {
  it.each([
    { unknown: [] }, { commit: ['KeyS'] }, { commit: ['KeyT', 'KeyT'] },
    { commit: ['Ctrl+KeyL'] }, { commit: ['Meta+KeyQ'] }, { commit: ['Alt+KeyT'] },
    { commit: ['Shift+Space'] }, { commit: ['Escape'] }, { commit: ['F5'] },
    { 'delete-row': ['Delete'] }, { 'delete-row': ['Backspace'] },
    { 'delete-row': ['Ctrl+KeyX'] }, { 'delete-row': ['Ctrl+Meta+Delete'] },
    { 'delete-row': ['Shift+Meta+Backspace'] }, { 'delete-row': ['Alt+Delete'] },
    { 'delete-row': ['KeyG'] }, { 'delete-row': ['KeyX', 'KeyX'] },
    { commit: ['Meta+Delete'] }, { commit: ['KeyX'], 'delete-row': ['KeyX'] },
  ])('rejects unknown, reserved and conflicting bindings: %j', value => {
    expect(validateOverrides(value as ShortcutOverrides)).toBeTruthy();
  });
  it('allows disabled actions, defaults, and explicit shift combinations', () => {
    for (const value of [{}, { commit: [] }, { commit: ['Shift+KeyT', 'KeyT'] },
      { 'delete-row': [] }, { 'delete-row': ['Shift+KeyX'] },
      { 'delete-row': shortcutDefaults['delete-row'].bindings },
      { 'delete-row': ['Meta+Backspace'] },
      { 'set-start-playhead': ['Ctrl+KeyB'], 'split-text': ['Meta+Shift+KeyT'] },
    ]) expect(validateOverrides(value)).toBeUndefined();
  });
});

it('detects editing command conflicts against all defaults and overrides', () => {
  expect(validateOverrides({ 'set-start-playhead': ['KeyQ'] })).toContain('冲突');
  expect(validateOverrides({ 'before-start': [], 'set-start-playhead': ['KeyQ'] })).toBeUndefined();
  expect(validateOverrides({ 'split-text': ['Enter'] })).toContain('冲突');
  expect(validateOverrides({ commit: ['KeyG'], 'split-text': ['Enter'] })).toBeUndefined();
  expect(validateOverrides({ 'split-text': ['Ctrl+KeyB'], 'split-playhead': ['Ctrl+KeyB'] })).toContain('冲突');
});
