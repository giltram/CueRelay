import defaults from '../../../shared/timing-shortcuts.json';
import { allowsShortcutFocus, isShortcutSuppressed, type AuditionMode, type ShortcutEvent } from '../media/playback';

export type EditingShortcut = 'set-start-playhead' | 'set-end-playhead' | 'split-playhead' | 'split-text';
export type TimingShortcut = 'commit' | AuditionMode | 'delete-row' | EditingShortcut | 'undo' | 'redo';
export type ShortcutOverrides = Partial<Record<TimingShortcut, string[]>>;
export const shortcutDefaults = defaults;
export const timingActions = Object.keys(defaults) as TimingShortcut[];

export function isEditingShortcut(action: TimingShortcut): action is EditingShortcut {
  return ['set-start-playhead', 'set-end-playhead', 'split-playhead', 'split-text'].includes(action);
}

export function bindingFor(event: Pick<ShortcutEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>): string {
  return `${event.ctrlKey ? 'Ctrl+' : ''}${event.metaKey ? 'Meta+' : ''}${event.altKey ? 'Alt+' : ''}${event.shiftKey ? 'Shift+' : ''}${event.code}`;
}

/** Existing explicit bindings win over newly introduced history defaults. */
export function effectiveBindings(action: TimingShortcut, overrides: ShortcutOverrides): string[] {
  const bindings = overrides[action] ?? defaults[action].bindings;
  if ((action === 'undo' || action === 'redo') && overrides[action] === undefined) {
    const explicit = Object.values(overrides).flat();
    return bindings.filter(binding => !explicit.includes(binding));
  }
  return bindings;
}

export function validateOverrides(overrides: ShortcutOverrides): string | undefined {
  if (Object.keys(overrides).some(action => !timingActions.includes(action as TimingShortcut))) return '未知快捷键动作';
  const used = new Set<string>();
  for (const action of timingActions) {
    const bindings = effectiveBindings(action, overrides);
    if (!Array.isArray(bindings) || bindings.length > 4) return '每个动作接受 0–4 个绑定';
    for (const binding of bindings) {
      const standard = /^(Key[A-Z]|Digit[0-9]|Enter|NumpadEnter|Space|Shift\+(Key[A-Z]|Digit[0-9]))$/.test(binding);
      const deletion = action === 'delete-row' && /^(Ctrl|Meta)\+(Delete|Backspace)$/.test(binding);
      const editing = (isEditingShortcut(action) || action === 'undo' || action === 'redo') && /^(Ctrl\+)?(Meta\+)?(Alt\+)?(Shift\+)?(Key[A-Z]|Digit[0-9]|Enter|NumpadEnter|Space)$/.test(binding);
      if (!standard && !deletion && !editing) {
        return '快捷键格式不正确。请使用英文逗号（,）分隔多个绑定，不能使用中文逗号（，）；检查键码（key）及大小写，例如 KeyG、Digit1、Shift+KeyT。也可使用“录制”按钮；仍无法录入请联系 dev。';
      }
      if (used.has(binding)) return `快捷键冲突：${binding}`;
      used.add(binding);
    }
  }
}

export function timingShortcut(event: ShortcutEvent, composing: boolean, overrides: ShortcutOverrides = {}, textEditor?: EventTarget | null): TimingShortcut | undefined {
  if (isShortcutSuppressed(event, composing)) return;
  const binding = bindingFor(event);
  const action = timingActions.find(action => effectiveBindings(action, overrides).includes(binding));
  // Only this exact subtitle textarea may consume a configured text split key.
  // Other inputs, defaults and native activation retain the existing focus rules.
  if (action === 'split-text' && textEditor && event.target === textEditor) return action;
  return allowsShortcutFocus(event, composing) ? action : undefined;
}
