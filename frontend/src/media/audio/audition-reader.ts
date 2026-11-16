import { describe, MessageError } from "../../contracts/messages";
import { diagnostics, safeError } from '../../diagnostics';
import type { AudioMetadata, PcmChunk } from './local-audio';
import type { AuditionRequest, AuditionResponse } from './audition-protocol';

export interface AuditionReader {
  open(): Promise<AudioMetadata>;
  read(start: number, end: number): Promise<PcmChunk[]>;
  dispose(): void;
}

/** A private decode session, independent of viewport requests and their cancellation. */
export class WorkerAuditionReader implements AuditionReader {
  private worker: Worker;
  private scope = diagnostics.scope();
  private diagnosticContext = diagnostics.contextSnapshot();
  private failure: Error | null = null;
  private pending: { resolve: (message: AuditionResponse) => void; reject: (error: Error) => void } | null = null;
  constructor(private file: File) {
    this.worker = new Worker(new URL('./audition.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<AuditionResponse>) => {
      const pending = this.pending; this.pending = null;
      if (event.data.type === 'error') {
        diagnostics.record('audio-audition', 'worker_result', 'error', { error: event.data.diagnostic ?? safeError(Error()) }, this.scope, this.diagnosticContext);
        pending?.reject(new MessageError(event.data.message));
      }
      else pending?.resolve(event.data);
    };
    const failed = () => {
      this.failure = new MessageError(describe("media.theLocalAudioPlaybackWorkerStoppedTryPlayback", "本地音频试听 Worker 中断，请重新试听"));
      diagnostics.record('audio-audition', 'worker_communication', 'error', { error: safeError(this.failure) }, this.scope, this.diagnosticContext);
      this.pending?.reject(this.failure); this.pending = null;
    };
    this.worker.onerror = failed; this.worker.onmessageerror = failed;
  }
  private request(message: AuditionRequest): Promise<AuditionResponse> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.worker.postMessage(message);
    });
  }
  async open() {
    const response = await this.request({ type: 'open', file: this.file });
    if (response.type !== 'ready') throw new MessageError(describe("media.couldNotInitializeThePlaybackAudioTrack", "试听音轨初始化失败"));
    return response.metadata;
  }
  async read(start: number, end: number) {
    const response = await this.request({ type: 'read', start, end });
    if (response.type !== 'pcm') throw new MessageError(describe("media.couldNotReadPlaybackAudio", "试听音频读取失败"));
    return response.chunks;
  }
  dispose() {
    this.worker.onmessage = null; this.worker.onerror = null; this.worker.onmessageerror = null;
    this.failure = Object.assign(new DOMException('Operation cancelled', 'AbortError'), { descriptor: describe("media.audioPlaybackCancelled", "试听已取消") });
    this.worker.terminate();
    this.pending?.reject(this.failure);
    this.pending = null;
  }
}
