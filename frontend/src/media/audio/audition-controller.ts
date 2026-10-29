import type { PlaybackRange } from '../playback';
import type { PcmChunk } from './local-audio';
import { auditionWindowSeconds } from './audition-protocol';
import type { AuditionReader } from './audition-reader';

export interface AuditionState {
  phase: 'idle' | 'preparing' | 'playing' | 'finished' | 'error';
  /** Milliseconds on the container presentation timeline; null delegates to video. */
  position: number | null;
  message: string;
}
interface ScheduledWindow { end: number; nodes: Set<AudioBufferSourceNode> }
interface Session {
  reader: AuditionReader;
  range: PlaybackRange;
  origin: number;
  next: number;
  span: number;
  windows: ScheduledWindow[];
  loading: boolean;
}

/** Copy only selected sample frames. Timestamps retain offsets and gaps, never concatenate time. */
export function scheduleAuditionChunks(
  context: BaseAudioContext, chunks: PcmChunk[], range: PlaybackRange, origin: number,
  nodes: Set<AudioBufferSourceNode>,
) {
  const start = range.start / 1000, end = range.end / 1000;
  for (const chunk of chunks) {
    const first = Math.max(0, Math.ceil((start - chunk.timestamp) * chunk.sampleRate - 1e-6));
    const last = Math.min(chunk.channels[0].length, Math.ceil((end - chunk.timestamp) * chunk.sampleRate - 1e-6));
    if (last <= first) continue;
    const buffer = context.createBuffer(chunk.channels.length, last - first, chunk.sampleRate);
    chunk.channels.forEach((channel, index) => buffer.getChannelData(index).set(channel.subarray(first, last)));
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.connect(context.destination);
    nodes.add(node);
    node.onended = () => { node.disconnect(); node.buffer = null; nodes.delete(node); };
    const timestamp = chunk.timestamp + first / chunk.sampleRate;
    node.start(origin + timestamp - start);
    // The rendering clock enforces the boundary even if JS cannot run at the out point.
    node.stop(origin + Math.min(end, chunk.timestamp + last / chunk.sampleRate) - start);
  }
}

function releaseWindow(window: ScheduledWindow) {
  for (const node of window.nodes) {
    node.onended = null; node.stop(); node.disconnect(); node.buffer = null;
  }
  window.nodes.clear();
}

/** Sole authority for audition position, preparation, scheduling and cancellation. No video writes. */
export class AudioAuditionController {
  private context: AudioContext | null = null;
  private session: Session | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private snapshot: AuditionState = { phase: 'idle', position: null, message: '' };
  get state(): Readonly<AuditionState> { return this.snapshot; }

  constructor(
    private createReader: () => AuditionReader,
    private changed: (state: AuditionState) => void,
    private createContext: () => AudioContext = () => new AudioContext(),
  ) {}

  private publish(state: AuditionState) { this.snapshot = state; this.changed(state); }
  private release() {
    const session = this.session; this.session = null;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    session?.windows.forEach(releaseWindow);
    session?.reader.dispose();
  }
  stop() {
    this.release();
    this.publish({ phase: 'idle', position: null, message: '' });
  }
  dispose() {
    this.disposed = true;
    this.release();
    void this.context?.close().catch(() => {});
    this.context = null;
  }
  private fail(session: Session | null, error: unknown) {
    if (this.session !== session || this.disposed) return;
    this.release();
    this.publish({ phase: 'error', position: null, message: `音频试听失败：${(error as Error).message}` });
  }

  async start(range: PlaybackRange) {
    if (this.disposed) return;
    this.stop();
    let session: Session | null = null;
    try {
      if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.start < 0 || range.end <= range.start) {
        throw Error('试听区间无效');
      }
      // Called synchronously from the user gesture, before waiting for decode/Worker startup.
      const context = this.context ??= this.createContext();
      const resumed = context.resume();
      // Attach rejection immediately, even while the reader is still opening.
      void resumed.catch(() => {});
      session = { reader: this.createReader(), range, origin: 0, next: range.start / 1000,
        span: 0, windows: [], loading: false };
      this.session = session;
      this.publish({ phase: 'preparing', position: range.start, message: '正在准备音频试听…' });
      const metadata = await session.reader.open();
      if (this.session !== session) return;
      session.span = auditionWindowSeconds(metadata);
      if (!Number.isFinite(session.span) || session.span <= 0) throw Error('音轨采样格式无效');
      const prepared: { end: number; chunks: PcmChunk[] }[] = [];
      // Short ranges are fully prepared; long ranges start with two bounded windows.
      while (prepared.length < 2 && session.next < range.end / 1000) {
        const end = Math.min(range.end / 1000, session.next + session.span);
        const chunks = await session.reader.read(session.next, end);
        if (this.session !== session) return;
        prepared.push({ end, chunks }); session.next = end;
      }
      await resumed;
      if (this.session !== session) return;
      if (context.state !== 'running') throw Error('浏览器尚未允许音频输出，请再次触发试听');
      session.origin = context.currentTime + 0.05;
      for (const window of prepared) this.schedule(session, window.end, window.chunks);
      if (context.currentTime >= session.origin) throw Error('音频排程未及时完成，请重新试听');
      this.publish({ phase: 'playing', position: range.start, message: '' });
      this.timer = setInterval(() => this.tick(session!), 25);
    } catch (error) { this.fail(session, error); }
  }

  private schedule(session: Session, end: number, chunks: PcmChunk[]) {
    const window = { end, nodes: new Set<AudioBufferSourceNode>() };
    session.windows.push(window);
    scheduleAuditionChunks(this.context!, chunks, session.range, session.origin, window.nodes);
  }
  getPosition(): number | null {
    const session = this.session;
    if (!session || this.state.phase !== 'playing') return this.state.position;
    return Math.min(session.range.end,
      session.range.start + Math.max(0, this.context!.currentTime - session.origin) * 1000);
  }
  private tick(session: Session) {
    if (this.session !== session) return;
    const context = this.context!;
    const position = this.getPosition()!;
    if (session.next < session.range.end / 1000 &&
        context.currentTime >= session.origin + session.next - session.range.start / 1000) {
      this.fail(session, Error('音频预取未及时完成，请重新试听'));
      return;
    }
    if (position >= session.range.end) {
      this.release();
      this.publish({ phase: 'finished', position: session.range.end, message: '' });
      return;
    }
    if (context.state !== 'running') { this.fail(session, Error('浏览器音频输出已中断，请重新试听')); return; }
    while (session.windows[0]?.end <= position / 1000) releaseWindow(session.windows.shift()!);
    this.publish({ phase: 'playing', position, message: '' });
    if (!session.loading && session.windows.length < 2 && session.next < session.range.end / 1000) {
      void this.prefetch(session);
    }
  }
  private async prefetch(session: Session) {
    session.loading = true;
    const start = session.next;
    const end = Math.min(session.range.end / 1000, start + session.span);
    try {
      const chunks = await session.reader.read(start, end);
      if (this.session !== session) return;
      // Never start late buffers at 'now', skip speech, or change the PTS mapping on underrun.
      if (this.context!.currentTime >= session.origin + start - session.range.start / 1000) {
        throw Error('音频预取未及时完成，请重新试听');
      }
      this.schedule(session, end, chunks); session.next = end;
    } catch (error) { this.fail(session, error); }
    finally { session.loading = false; }
  }
}
