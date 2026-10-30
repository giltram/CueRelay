import { diagnostics, safeError } from '../diagnostics';
import type { AssDocument } from '../contracts/subtitles';

export type PreviewStatus = { phase: 'loading' | 'ready' | 'error'; message?: string };
export interface PreviewRenderer {
  ready: Promise<void>;
  setTrack: (content: string) => Promise<void>;
  setVisible: (visible: boolean) => void;
  destroy: () => void;
}
interface Dependencies {
  serialize: (document: AssDocument, signal: AbortSignal) => Promise<string>;
  createRenderer: (content: string, onFailure: (error: Error) => void) => PreviewRenderer;
  onStatus: (status: PreviewStatus) => void;
}

/** A disposable view of editor snapshots, never a persistence or subtitle store. */
export class PreviewSession {
  private version = 0;
  private scope = diagnostics.scope();
  private diagnosticContext = diagnostics.contextSnapshot();
  private lastPhase = '';
  private status(status: PreviewStatus) {
    if (this.lastPhase !== status.phase) diagnostics.record('ass-preview', 'phase', status.phase === 'error' ? 'error' : 'success', { reason: status.phase }, this.scope, this.diagnosticContext);
    this.lastPhase = status.phase; this.dependencies.onStatus(status);
  }
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private conversion?: AbortController;
  private renderer?: PreviewRenderer;
  private pending?: { content: string; version: number };
  private applying = false;
  private content?: string;
  private visible = true;
  private failed = false;

  constructor(private readonly dependencies: Dependencies, private readonly delay = 120) {}

  update(document: AssDocument) {
    if (this.disposed || this.failed) return;
    const version = ++this.version;
    clearTimeout(this.timer);
    this.conversion?.abort();
    this.pending = undefined;
    this.timer = setTimeout(() => { void this.convert(document, version); }, this.delay);
  }

  setVisible(visible: boolean) {
    this.visible = visible;
    this.renderer?.setVisible(visible && this.content !== undefined && !this.failed);
  }

  private async convert(document: AssDocument, version: number) {
    const conversion = new AbortController();
    this.conversion = conversion;
    try {
      const content = await this.dependencies.serialize(document, conversion.signal);
      if (this.disposed || version !== this.version) return;
      this.pending = { content, version };
      await this.apply();
    } catch (reason) {
      if (this.disposed || version !== this.version) return;
      diagnostics.record('ass-preview', 'conversion_failure', 'error', { error: safeError(reason) }, this.scope, this.diagnosticContext);
      // A partial edit may temporarily fail export validation. Hide the stale
      // track, but keep the renderer alive so the next valid edit recovers.
      this.content = undefined;
      this.renderer?.setVisible(false);
      this.status({ phase: 'error', message: `字幕预览暂不可用：${(reason as Error).message}` });
    }
  }

  private async apply() {
    if (this.applying) return;
    this.applying = true;
    try {
      while (this.pending && !this.disposed && !this.failed) {
        const next = this.pending;
        this.pending = undefined;
        if (!this.renderer) {
          this.status({ phase: 'loading' });
          this.renderer = this.dependencies.createRenderer(next.content, error => this.fail(error));
          await this.renderer.ready;
        }
        if (this.disposed || this.failed || next.version !== this.version) continue;
        if (next.content !== this.content) await this.renderer.setTrack(next.content);
        if (this.disposed || this.failed || next.version !== this.version) continue;
        this.content = next.content;
        this.renderer.setVisible(this.visible);
        this.status({ phase: 'ready' });
      }
    } catch (reason) {
      this.fail(reason as Error);
    } finally { this.applying = false; }
  }

  private fail(error: Error) {
    if (this.disposed || this.failed) return;
    diagnostics.record('ass-preview', 'renderer_failure', 'error', { error: safeError(error) }, this.scope, this.diagnosticContext);
    this.failed = true;
    clearTimeout(this.timer);
    this.conversion?.abort();
    this.pending = undefined;
    this.renderer?.destroy();
    this.status({ phase: 'error', message: `ASS 渲染失败：${error.message}。可关闭后重新开启字幕预览。` });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    ++this.version;
    clearTimeout(this.timer);
    this.conversion?.abort();
    this.pending = undefined;
    this.renderer?.destroy();
  }
}
