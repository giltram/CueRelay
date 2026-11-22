import { describe, expect, it } from 'vitest';
import { allowsShortcut, formatTime, isFullscreenPlaybackShortcut, parseTime, seekVideo, snapTime, validateInterval } from './playback';

describe('10ms timing contract', () => {
  it('snaps captures and roundtrips Chinese workbench timing values', () => {
    expect(snapTime(1.234)).toBe(1230);
    expect(snapTime(1.2351)).toBe(1240);
    for (const milliseconds of [0, 10, 1230, 60000, 3723450, 35_999_990]) {
      expect(parseTime(formatTime(milliseconds))).toBe(milliseconds);
    }
  });
  it('allows zero duration but rejects negative, inverted and off-grid intervals', () => {
    for (const [start, end] of [[-10, 100], [100, 10], [1, 100], [0, 101], [0, Infinity], [0, 36_000_000]]) {
      expect(() => validateInterval(start, end)).toThrow();
    }
    expect(() => validateInterval(10, 20)).not.toThrow();
    expect(() => validateInterval(0, 0)).not.toThrow();
    expect(() => validateInterval(snapTime(1.001), snapTime(1.004))).not.toThrow();
  });
  it('rejects malformed times and invalid player captures', () => {
    for (const text of ['0:00:60.00', '0:60:00.00', '-0:00:01.00', '0:00:01.001', '', 'NaN', '10:00:00.00']) {
      expect(() => parseTime(text)).toThrow();
    }
    expect(() => snapTime(NaN)).toThrow();
    expect(() => snapTime(-1)).toThrow();
  });
  it('does not truncate subtitle times when seek exceeds reported duration', () => {
    const video = { duration: 10, readyState: 1, currentTime: 0 } as HTMLVideoElement;
    seekVideo(video, 1230);
    expect(video.currentTime).toBe(1.23);
    expect(() => seekVideo(video, 10010)).toThrow();
    expect(video.currentTime).toBe(1.23);
  });
});

describe('fullscreen playback shortcut guard', () => {
  const base = { code: 'Space', target: null, isComposing: false, keyCode: 0, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false };
  it.each(['video', 'button', null])('accepts playback keys with %s focus while normal Space keeps its filtering', control => {
    const target = control ? { closest: (selector: string) => selector.split(', ').includes(control) ? {} : null } as unknown as EventTarget : null;
    for (const code of ['Space', 'ArrowLeft', 'ArrowRight']) {
      expect(isFullscreenPlaybackShortcut({ ...base, code, target }, false)).toBe(true);
    }
    if (control) expect(allowsShortcut({ ...base, target }, false)).toBe(false);
  });
  it.each(['Space', 'ArrowLeft', 'ArrowRight'])('preserves IME, modifier and already handled key protection for %s, while claiming repeats', code => {
    const event = { ...base, code };
    expect(isFullscreenPlaybackShortcut({ ...event, repeat: true }, false)).toBe(true);
    for (const property of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'isComposing', 'defaultPrevented']) {
      expect(isFullscreenPlaybackShortcut({ ...event, [property]: true }, false)).toBe(false);
    }
    expect(isFullscreenPlaybackShortcut(event, true)).toBe(false);
    expect(isFullscreenPlaybackShortcut({ ...event, keyCode: 229 }, false)).toBe(false);
    expect(isFullscreenPlaybackShortcut({ ...base, code: 'KeyS' }, false)).toBe(false);
  });
  it.each(['input', 'textarea', 'select', '[contenteditable]:not([contenteditable="false"])', '[role="textbox"]'])('does not steal playback keys from %s', control => {
    const target = { closest: (selector: string) => selector.split(', ').includes(control) ? {} : null } as unknown as EventTarget;
    for (const code of ['Space', 'ArrowLeft', 'ArrowRight']) {
      expect(isFullscreenPlaybackShortcut({ ...base, code, target }, false)).toBe(false);
    }
  });
});

describe('shortcuts leave editing and IME alone', () => {
  const base = { code: 'KeyS', target: null, isComposing: false, keyCode: 0, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false };
  it('only enables unmodified non-repeating keys outside controls', () => {
    expect(allowsShortcut(base, false)).toBe(true);
    for (const property of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'repeat', 'isComposing']) {
      expect(allowsShortcut({ ...base, [property]: true }, false)).toBe(false);
    }
    expect(allowsShortcut(base, true)).toBe(false);
    expect(allowsShortcut({ ...base, keyCode: 229 }, false)).toBe(false);
  });
  it.each(['input', 'textarea', 'select', '[contenteditable]:not([contenteditable="false"])', '[role="textbox"]', 'video'])(
    'ignores an event inside %s', control => {
      const target = { closest: (selector: string) => selector.split(', ').includes(control) ? {} : null } as unknown as EventTarget;
      expect(allowsShortcut({ ...base, target }, false)).toBe(false);
    });
  it('allows timing letters after clicking a button without stealing its native activation', () => {
    // The target can be a nested kbd/span inside the focused button.
    const target = {
      closest: (selector: string) => selector.includes('button') ? { tagName: 'BUTTON' } : null,
    } as unknown as EventTarget;
    expect(allowsShortcut({ ...base, target, code: 'KeyS' }, false)).toBe(true);
    expect(allowsShortcut({ ...base, target, code: 'KeyG' }, false)).toBe(true);
    for (const code of ['Space', 'Enter', 'NumpadEnter']) {
      expect(allowsShortcut({ ...base, target, code }, false)).toBe(false);
    }
    expect(allowsShortcut({ ...base, target, isComposing: true }, false)).toBe(false);
    expect(allowsShortcut({ ...base, target }, true)).toBe(false);
  });
});
