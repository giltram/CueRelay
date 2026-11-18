import { sameDraftContent, type DraftContent, type WorkspaceDraft } from './model';
import type { DraftStore } from './store';

export type DraftStatus = 'idle' | 'saving' | 'saved' | 'failed';

const debounceMs = 750;
const maxWaitMs = 3000;

/** Owns one writable record. Candidate drafts remain separate until explicitly restored. */
export class DraftAutosave {
  private id: string = crypto.randomUUID();
  private content: DraftContent | null = null;
  private pending = false;
  private stopped = false;
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private deadline: number | undefined;

  constructor(
    private readonly store: Pick<DraftStore, 'write' | 'remove'>,
    private readonly scope: string,
    private readonly tabId: string,
    private readonly status: (status: DraftStatus) => void,
  ) {}

  update(content: DraftContent | null) {
    if (this.stopped || sameDraftContent(this.content, content)) return;
    const revisionChanged = this.content && this.content.baseRevision !== content?.baseRevision;
    this.content = content;
    this.pending = true;
    this.sequence++;
    this.status('saving');
    if (!content || revisionChanged) { this.flush(); return; }
    clearTimeout(this.timer);
    const now = Date.now();
    this.deadline ??= now + maxWaitMs;
    this.timer = setTimeout(() => this.flush(), Math.min(debounceMs, this.deadline - now));
  }

  flush() {
    this.clearTimer();
    if (!this.pending || this.stopped) return;
    this.pending = false;
    const content = this.content;
    const sequence = ++this.sequence;
    this.status('saving');
    // Start the transaction now, including during pagehide. IndexedDB orders
    // read/write transactions on this store by creation, even across connections.
    const operation = content ? this.store.write({
      ...content, id: this.id, scope: this.scope, tabId: this.tabId,
      schemaVersion: 1, updatedAt: Date.now(), version: crypto.randomUUID(),
    }) : this.store.remove(this.id);
    void operation.then(() => {
      if (this.sequence === sequence && !this.stopped) this.status(content ? 'saved' : 'idle');
    }, () => {
      if (this.sequence !== sequence || this.stopped) return;
      this.pending = true;
      this.status('failed');
    });
  }

  adopt(record: WorkspaceDraft) {
    this.clearTimer();
    this.sequence++;
    this.id = record.id;
    this.content = record;
    this.pending = false;
    this.status('saved');
  }

  async discard() {
    this.stopped = true;
    this.clearTimer();
    await this.store.remove(this.id);
    this.status('idle');
  }

  private clearTimer() {
    clearTimeout(this.timer);
    this.deadline = undefined;
  }
}
