/** Shared command identities for menus, dispatch and settings validation. */
export const lineActions = [
  'insert-before', 'insert-after', 'insert-video-before', 'insert-video-after',
  'duplicate-lines', 'split-frame-before', 'split-frame-after',
  'cut-lines', 'copy-lines', 'paste-lines', 'paste-lines-over',
] as const;
export type LineAction = typeof lineActions[number];
export function isLineAction(action: string): action is LineAction {
  return (lineActions as readonly string[]).includes(action);
}
export function needsVideoFrame(action: LineAction): boolean {
  return action.startsWith('insert-video-') || action.startsWith('split-frame-');
}
