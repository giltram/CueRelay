import { describe, expect, it } from 'vitest';
import { timingShortcut } from './timing-shortcuts';

const base = { code: 'KeyG', target: null, isComposing: false, keyCode: 0, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false };

describe('default timing shortcuts', () => {
  it.each([
    ['KeyG', 'commit'], ['Enter', 'commit'], ['NumpadEnter', 'commit'],
    ['KeyS', 'selection'], ['Space', 'selection'],
    ['KeyQ', 'before-start'], ['KeyW', 'after-end'], ['KeyE', 'first-500'], ['KeyD', 'last-500'],
  ])('maps %s to %s', (code, action) => {
    expect(timingShortcut({ ...base, code }, false)).toBe(action);
  });

  it.each(['KeyI', 'KeyO', 'KeyJ', 'KeyK', 'KeyU', 'KeyP', 'KeyL', 'KeyN', 'ArrowLeft', 'ArrowRight', 'Home', 'End'])(
    'does not bind %s', code => expect(timingShortcut({ ...base, code }, false)).toBeUndefined(),
  );

  it('ignores composition, modifiers, repeats and events handled elsewhere', () => {
    for (const code of ['KeyG', 'Enter', 'KeyS', 'Space', 'KeyQ', 'KeyW', 'KeyE', 'KeyD']) {
      for (const property of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'repeat', 'isComposing', 'defaultPrevented']) {
        expect(timingShortcut({ ...base, code, [property]: true }, false)).toBeUndefined();
      }
      expect(timingShortcut({ ...base, code }, true)).toBeUndefined();
      expect(timingShortcut({ ...base, code, keyCode: 229 }, false)).toBeUndefined();
      const target = { closest: () => ({}) } as unknown as EventTarget;
      expect(timingShortcut({ ...base, code, target }, false)).toBeUndefined();
    }
  });

  it('preserves native activation on a focused button while allowing timing letters', () => {
    const target = { closest: (selector: string) => selector.includes('button') ? {} : null } as unknown as EventTarget;
    for (const code of ['Space', 'Enter', 'NumpadEnter']) {
      expect(timingShortcut({ ...base, code, target }, false)).toBeUndefined();
    }
    expect(timingShortcut({ ...base, target }, false)).toBe('commit');
    expect(timingShortcut({ ...base, code: 'KeyS', target }, false)).toBe('selection');
  });
});
