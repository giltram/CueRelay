import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { effectiveBindings, shortcutDefaults, type ShortcutOverrides, type TimingShortcut } from './timing-shortcuts';
import { needsVideoFrame, type LineAction } from './line-actions';
import './cue-context-menu.css';

export type CueMenuAction = LineAction | 'delete-row';
const groups: CueMenuAction[][] = [
  ['insert-before', 'insert-after', 'insert-video-before', 'insert-video-after'],
  ['duplicate-lines', 'split-frame-before', 'split-frame-after'],
  ['cut-lines', 'copy-lines', 'paste-lines', 'paste-lines-over', 'delete-row'],
];
interface Props {
  x: number; y: number; keyboard: boolean; editable: boolean; hasVideo: boolean; overrides: ShortcutOverrides;
  onAction: (action: CueMenuAction) => void; onClose: () => void;
}
export function CueContextMenu({ x, y, keyboard, editable, hasVideo, overrides, onAction, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const shortcutLabel = (action: CueMenuAction) => {
    const bindings = effectiveBindings(action as TimingShortcut, overrides);
    const binding = bindings.find(value => mac ? !value.includes('Ctrl+') : !value.includes('Meta+')) ?? bindings[0] ?? '';
    return binding.replaceAll('Meta+', 'Cmd+').replaceAll('Key', '').replaceAll('Digit', '');
  };
  useLayoutEffect(() => {
    const menu = ref.current!;
    const rect = menu.getBoundingClientRect();
    setPosition({ left: Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)) });
    // Pointer opening has no active item yet; keep focus on the menu so arrow
    // keys still work without making the first command look preselected.
    const target = keyboard ? menu.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? menu : menu;
    target.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node)) onClose(); };
    const dismiss = () => onClose();
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('resize', dismiss); window.removeEventListener('blur', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [x, y, keyboard]);
  return createPortal(<div ref={ref} role="menu" tabIndex={-1} aria-label="字幕行操作" className="cue-context-menu" style={position}
    onContextMenu={event => event.preventDefault()} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); onClose(); return; }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = [...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const current = items.indexOf(window.document.activeElement as HTMLButtonElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : current < 0 ? event.key === 'ArrowDown' ? 0 : items.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[index]?.focus();
    }}>
    {groups.map((group, index) => <div role="group" key={index}>
      {group.map(action => <button key={action} role="menuitem" disabled={(action !== 'copy-lines' && !editable) || (action !== 'delete-row' && needsVideoFrame(action) && !hasVideo)}
        onClick={() => { onClose(); onAction(action); }}>
        <span>{shortcutDefaults[action].label}</span><kbd>{shortcutLabel(action)}</kbd>
      </button>)}
    </div>)}
  </div>, window.document.body);
}
