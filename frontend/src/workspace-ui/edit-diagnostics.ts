import type { EditState } from './edit-history';
import { diagnostics } from '../diagnostics';
import type { Context, EventData, Outcome } from '../diagnostics/schema';

type Emit = (action: string, outcome: Outcome, data: EventData, scope: number, context: Context) => void;
/** Read-only references to existing immutable states, never a second writable subtitle store. */
export class EditDiagnostics {
  private pending?: { before: EditState; after: EditState; group: string | null; action: string; scope: number; context: Context };
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private emit: Emit = (action, outcome, data, scope, context) => diagnostics.record('editor', action, outcome, data, scope, context), private owner?: number) {}
  observe(before: EditState, after: EditState, group: string | null, action = 'edit') {
    try {
      if (this.owner !== undefined && !diagnostics.isOwner(this.owner)) return;
      if (this.pending && (group === null || group !== this.pending.group)) this.flush();
      if (this.pending) this.pending.after = after;
      else this.pending = { before, after, group, action, scope: diagnostics.scope(), context: diagnostics.contextSnapshot() };
      clearTimeout(this.timer);
      // Bounded inactivity flush is independent of undo grouping, including IME.
      this.timer = setTimeout(() => this.flush(), 1000);
      if (group === null) this.flush();
    } catch { /* Diagnostics must never change edit behavior. */ }
  }
  flush() {
    clearTimeout(this.timer);
    const pending = this.pending; this.pending = undefined;
    if (!pending) return;
    try {
      const { before, after, action, scope, context } = pending;
      const emit = (data: EventData) => this.emit(action, 'changed', data, scope, context);
      if (before.document !== after.document) {
        const previous = new Map(before.document?.cues.map(cue => [cue.id, cue]) ?? []);
        for (const cue of after.document?.cues ?? []) {
          const old = previous.get(cue.id); previous.delete(cue.id);
          if (old !== cue && (!old || old.text !== cue.text || old.start_ms !== cue.start_ms || old.end_ms !== cue.end_ms || old.style_id !== cue.style_id)) {
            emit({ cueId: cue.id, ...(old ? { before: old } : {}), after: cue });
          }
        }
        for (const cue of previous.values()) emit({ cueId: cue.id, before: cue });
        // Never collect source templates, origin metadata or entire document snapshots.
        if (before.document?.styles !== after.document?.styles) {
          const oldStyles = new Map(before.document?.styles.map(style => [style.id, style]) ?? []);
          for (const style of after.document?.styles ?? []) {
            const old = oldStyles.get(style.id); oldStyles.delete(style.id);
            if (JSON.stringify(old?.fields) !== JSON.stringify(style.fields) || old?.name !== style.name) {
              if (old) emit({ styleId: style.id, reason: 'style_before', fields: { name: old.name, ...old.fields } });
              emit({ styleId: style.id, reason: 'style_after', fields: { name: style.name, ...style.fields } });
            }
          }
          for (const style of oldStyles.values()) emit({ styleId: style.id, reason: 'style_deleted', fields: { name: style.name, ...style.fields } });
        }
        if (before.document?.script !== after.document?.script && after.document) {
          if (before.document) emit({ reason: 'script_before', fields: { ...before.document.script } });
          emit({ reason: 'script_after', fields: { ...after.document.script } });
        }
      }
      if (before.startText !== after.startText || before.endText !== after.endText) {
        const draft = (state: EditState) => ({ startText: state.startText, endText: state.endText, selectedId: state.selectedId });
        emit({ draftBefore: draft(before), draftAfter: draft(after) });
      }
    } catch { /* Business state and history remain untouched. */ }
  }
}
