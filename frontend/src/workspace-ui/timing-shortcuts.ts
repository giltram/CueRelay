import { allowsShortcut, type AuditionMode, type ShortcutEvent } from '../media/playback';

export type TimingShortcut = 'commit' | AuditionMode;

const shortcuts: Readonly<Record<string, TimingShortcut>> = {
  KeyG: 'commit', Enter: 'commit', NumpadEnter: 'commit',
  KeyS: 'selection', Space: 'selection',
  KeyQ: 'before-start', KeyW: 'after-end', KeyE: 'first-500', KeyD: 'last-500',
};

export function timingShortcut(event: ShortcutEvent, composing: boolean): TimingShortcut | undefined {
  return allowsShortcut(event, composing) ? shortcuts[event.code] : undefined;
}
