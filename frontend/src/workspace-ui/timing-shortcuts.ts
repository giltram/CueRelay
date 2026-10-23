import { allowsShortcut, type AuditionMode, type ShortcutEvent } from '../media/playback';

export type TimingShortcut = 'commit' | 'delete-row' | AuditionMode;

const shortcuts: Readonly<Record<string, TimingShortcut>> = {
  KeyG: 'commit', Enter: 'commit', NumpadEnter: 'commit',
  KeyS: 'selection', Space: 'selection',
  KeyQ: 'before-start', KeyW: 'after-end', KeyE: 'first-500', KeyD: 'last-500',
};

export function timingShortcut(event: ShortcutEvent, composing: boolean): TimingShortcut | undefined {
  // Mac's backward Delete reports Backspace; forward Delete reports Delete.
  if (['Delete', 'Backspace'].includes(event.code) && event.ctrlKey !== event.metaKey) {
    return allowsShortcut(event, composing, true) ? 'delete-row' : undefined;
  }
  return allowsShortcut(event, composing) ? shortcuts[event.code] : undefined;
}
