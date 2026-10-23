import defaults from '../../../shared/timing-shortcuts.json';
import { allowsShortcutFocus, type AuditionMode, type ShortcutEvent } from '../media/playback';

export type TimingShortcut = 'commit' | AuditionMode;
export type ShortcutOverrides = Partial<Record<TimingShortcut, string[]>>;
export const shortcutDefaults = defaults;
export const timingActions = Object.keys(defaults) as TimingShortcut[];

export function bindingFor(event: Pick<ShortcutEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>): string {
  return `${event.ctrlKey ? 'Ctrl+' : ''}${event.metaKey ? 'Meta+' : ''}${event.altKey ? 'Alt+' : ''}${event.shiftKey ? 'Shift+' : ''}${event.code}`;
}

export function validateOverrides(overrides: ShortcutOverrides): string | undefined {
  if (Object.keys(overrides).some(action => !timingActions.includes(action as TimingShortcut))) return '未知快捷键动作';
  const used = new Set<string>();
  for (const action of timingActions) {
    const bindings = overrides[action] ?? defaults[action].bindings;
    if (!Array.isArray(bindings) || bindings.length > 4) return '每个动作接受 0–4 个绑定';
    for (const binding of bindings) {
      if (!/^(Shift\+)?(Key[A-Z]|Digit[0-9]|Enter|NumpadEnter|Space)$/.test(binding) || /^Shift\+(Enter|NumpadEnter|Space)$/.test(binding)) {
        return '仅支持字母、数字、Enter、Space，以及 Shift+字母/数字；其他组合为保留键';
      }
      if (used.has(binding)) return `快捷键冲突：${binding}`;
      used.add(binding);
    }
  }
}

export function timingShortcut(event: ShortcutEvent, composing: boolean, overrides: ShortcutOverrides = {}): TimingShortcut | undefined {
  if (!allowsShortcutFocus(event, composing)) return;
  const binding = bindingFor(event);
  return timingActions.find(action => (overrides[action] ?? defaults[action].bindings).includes(binding));
}
