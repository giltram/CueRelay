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

  it('allows Enter and Space on boundary sliders while preserving their arrow keys', () => {
    const target = { closest: (selector: string) => selector.includes('button') || selector === '[role="slider"]' ? {} : null } as unknown as EventTarget;
    for (const [code, action] of [['Enter', 'commit'], ['NumpadEnter', 'commit'], ['Space', 'selection']]) {
      expect(timingShortcut({ ...base, code, target }, false)).toBe(action);
      expect(timingShortcut({ ...base, code, target, isComposing: true }, false)).toBeUndefined();
      expect(timingShortcut({ ...base, code, target, defaultPrevented: true }, false)).toBeUndefined();
    }
    expect(timingShortcut({ ...base, code: 'ArrowRight', target }, false)).toBeUndefined();
  });

  it.each(['Delete', 'Backspace'])('deletes with Ctrl/Cmd + %s only outside editing controls', code => {
    for (const modifier of ['ctrlKey', 'metaKey']) {
      const event = { ...base, code, [modifier]: true };
      expect(timingShortcut(event, false)).toBe('delete-row');
      for (const property of ['altKey', 'shiftKey', 'repeat', 'isComposing', 'defaultPrevented']) {
        expect(timingShortcut({ ...event, [property]: true }, false)).toBeUndefined();
      }
      expect(timingShortcut(event, true)).toBeUndefined();
      expect(timingShortcut({ ...event, keyCode: 229 }, false)).toBeUndefined();
      for (const control of ['input', 'textarea', 'select', '[contenteditable]:not([contenteditable="false"])', '[role="textbox"]', 'video']) {
        const target = { closest: (selector: string) => selector.split(', ').includes(control) ? {} : null } as unknown as EventTarget;
        expect(timingShortcut({ ...event, target }, false)).toBeUndefined();
      }
    }
    expect(timingShortcut({ ...base, code }, false)).toBeUndefined();
    expect(timingShortcut({ ...base, code, ctrlKey: true, metaKey: true }, false)).toBeUndefined();
  });
});

// Overrides replace all aliases for one action; focus and IME checks still apply.
describe('custom timing shortcuts', () => {
  const overrides = { commit: ['Shift+KeyT'] };
  it('replaces or disables every deletion alias and restores defaults without an override', () => {
    const custom = { 'delete-row': ['Shift+KeyX'] };
    expect(timingShortcut({ ...base, code: 'KeyX', shiftKey: true }, false, custom)).toBe('delete-row');
    expect(timingShortcut({ ...base, code: 'KeyX' }, false, custom)).toBeUndefined();
    expect(timingShortcut({ ...base, code: 'KeyX', shiftKey: true }, true, custom)).toBeUndefined();
    const target = { closest: () => ({}) } as unknown as EventTarget;
    expect(timingShortcut({ ...base, code: 'KeyX', shiftKey: true, target }, false, custom)).toBeUndefined();
    for (const code of ['Delete', 'Backspace']) {
      for (const modifier of ['ctrlKey', 'metaKey']) {
        const event = { ...base, code, [modifier]: true };
        expect(timingShortcut(event, false, custom)).toBeUndefined();
        expect(timingShortcut(event, false, { 'delete-row': [] })).toBeUndefined();
        expect(timingShortcut(event, false, {})).toBe('delete-row');
      }
    }
    expect(timingShortcut({ ...base, code: 'KeyX', shiftKey: true }, false, { 'delete-row': [] })).toBeUndefined();
  });

  it('matches only the configured Ctrl/Cmd deletion aliases', () => {
    const custom = { 'delete-row': ['Meta+Backspace'] };
    expect(timingShortcut({ ...base, code: 'Backspace', metaKey: true }, false, custom)).toBe('delete-row');
    expect(timingShortcut({ ...base, code: 'Delete', metaKey: true }, false, custom)).toBeUndefined();
    expect(timingShortcut({ ...base, code: 'Backspace', ctrlKey: true }, false, custom)).toBeUndefined();
  });

  it('requires the exact configured modifiers and replaces all default aliases', () => {
    expect(timingShortcut({ ...base, code: 'KeyT', shiftKey: true }, false, overrides)).toBe('commit');
    expect(timingShortcut({ ...base, code: 'KeyT' }, false, overrides)).toBeUndefined();
    expect(timingShortcut({ ...base, code: 'KeyT', shiftKey: true, ctrlKey: true }, false, overrides)).toBeUndefined();
    for (const code of ['KeyG', 'Enter', 'NumpadEnter']) expect(timingShortcut({ ...base, code }, false, overrides)).toBeUndefined();
    expect(timingShortcut({ ...base, code: 'KeyT', shiftKey: true }, true, overrides)).toBeUndefined();
    expect(timingShortcut({ ...base, code: 'KeyT', shiftKey: true, target: { closest: () => ({}) } as unknown as EventTarget }, false, overrides)).toBeUndefined();
    expect(timingShortcut(base, false, { commit: [] })).toBeUndefined();
    expect(timingShortcut(base, false, {})).toBe('commit');
  });
});

describe('unbound editing commands', () => {
  it('matches custom editing modifiers and protects IME and input focus', () => {
    const overrides = { 'set-start-playhead': ['Ctrl+KeyB'] };
    const event = { ...base, code: 'KeyB', ctrlKey: true };
    expect(timingShortcut(event, false, overrides)).toBe('set-start-playhead');
    expect(timingShortcut(event, false)).toBeUndefined();
    for (const property of ['repeat', 'isComposing', 'defaultPrevented', 'altKey']) {
      expect(timingShortcut({ ...event, [property]: true }, false, overrides)).toBeUndefined();
    }
    expect(timingShortcut(event, true, overrides)).toBeUndefined();
    expect(timingShortcut({ ...event, keyCode: 229 }, false, overrides)).toBeUndefined();
    expect(timingShortcut({ ...event, target: { closest: () => ({}) } as unknown as EventTarget }, false, overrides)).toBeUndefined();
  });
});

describe('text cursor split shortcut focus', () => {
  const textEditor = { closest: () => ({}) } as unknown as EventTarget;
  const overrides = { commit: ['KeyG'], 'split-text': ['Enter', 'Ctrl+KeyB'] };
  it('handles only a configured key in the exact subtitle editor', () => {
    for (const event of [{ ...base, code: 'Enter' }, { ...base, code: 'KeyB', ctrlKey: true }]) {
      expect(timingShortcut({ ...event, target: textEditor }, false, overrides, textEditor)).toBe('split-text');
      expect(timingShortcut({ ...event, target: textEditor }, false, overrides)).toBeUndefined();
      const otherInput = { closest: () => ({}) } as unknown as EventTarget;
      expect(timingShortcut({ ...event, target: otherInput }, false, overrides, textEditor)).toBeUndefined();
      for (const flag of ['isComposing', 'repeat', 'defaultPrevented']) {
        expect(timingShortcut({ ...event, target: textEditor, [flag]: true }, false, overrides, textEditor)).toBeUndefined();
      }
      expect(timingShortcut({ ...event, target: textEditor, keyCode: 229 }, false, overrides, textEditor)).toBeUndefined();
      expect(timingShortcut({ ...event, target: textEditor }, true, overrides, textEditor)).toBeUndefined();
    }
    for (const code of ['KeyG', 'Space', 'KeyQ', 'KeyW', 'KeyE', 'KeyD']) {
      expect(timingShortcut({ ...base, code, target: textEditor }, false, overrides, textEditor)).toBeUndefined();
    }
    expect(timingShortcut({ ...base, code: 'Enter', target: textEditor }, false, {}, textEditor)).toBeUndefined();
  });
});
