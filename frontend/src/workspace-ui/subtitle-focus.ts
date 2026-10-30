import { bindingFor } from './timing-shortcuts';

/** Configured navigation between timing surfaces and the current subtitle editor.
 * The caller owns availability (selection, permissions, visibility and dialogs).
 */
export function handleSubtitleFocusShortcut(
  event: KeyboardEvent,
  composing: boolean,
  workbench: HTMLElement | null,
  textEditor: HTMLTextAreaElement | null,
  binding: string,
): boolean {
  if (bindingFor(event) !== binding
    || event.defaultPrevented || composing || event.isComposing || event.keyCode === 229
    || !workbench || !textEditor || textEditor.matches(':disabled') || textEditor.readOnly) return false;

  const target = event.target;
  const fromText = target === textEditor;
  // AudioBoundary sliders are inside audio-stage. Other buttons, sliders,
  // scrollbars, separators and form fields keep their native Tab navigation.
  const fromTiming = target === workbench || (target instanceof Element
    && workbench.contains(target) && Boolean(target.closest('.audio-stage')));
  if (!fromText && !fromTiming) return false;

  // Claim repeats too, so holding the key neither toggles again nor navigates away.
  event.preventDefault();
  if (!event.repeat) (fromText ? workbench : textEditor).focus({ preventScroll: true });
  return true;
}
