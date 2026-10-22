import { AudioSampleSink, BlobSource, Input, MP4, type InputAudioTrack } from 'mediabunny';

export const AUDIO_READ_CACHE_BYTES = 8 * 1024 * 1024;
export const MAX_AUDIO_WINDOW_SECONDS = 10;
export const MAX_WINDOW_PCM_BYTES = 16 * 1024 * 1024;

export type AudioExtractionErrorCode = 'unreadable' | 'no-audio' | 'unsupported' | 'decode' | 'range' | 'disposed';
export class AudioExtractionError extends Error {
  constructor(readonly code: AudioExtractionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AudioExtractionError';
  }
}

export interface AudioMetadata {
  codec: string;
  sampleRate: number;
  channels: number;
  /** Container presentation time, never rebased to the audio track's start. Seconds. */
  firstTimestamp: number;
  endTimestamp: number | null;
}

export interface PcmChunk {
  timestamp: number;
  sampleRate: number;
  /** Original channels; no mixing that could cancel opposite-phase speech. */
  channels: Float32Array[];
}

function aborted(): DOMException { return new DOMException('音频提取已取消', 'AbortError'); }

/** Local, silent PCM access. Own one session per selected File and dispose on replacement/unmount. */
export class LocalAudioSource {
  private active: AbortController | null = null;

  private constructor(
    private input: Input<BlobSource>, private track: InputAudioTrack, readonly metadata: AudioMetadata,
    private readStats: { bytes: number; largest: number },
  ) {}

  static async open(file: Blob, signal?: AbortSignal): Promise<LocalAudioSource> {
    if (signal?.aborted) throw aborted();
    // MP4 only for the first feasibility slice. Never call file.arrayBuffer() or decodeAudioData().
    const source = new BlobSource(file, { maxCacheSize: AUDIO_READ_CACHE_BYTES });
    const stats = { bytes: 0, largest: 0 };
    source.on('read', ({ start, end }) => {
      stats.bytes += end - start;
      stats.largest = Math.max(stats.largest, end - start);
    });
    const input = new Input({ source, formats: [MP4] });
    const cancel = () => input.dispose();
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      if (!await input.canRead()) throw new AudioExtractionError('unreadable', '音频提取暂仅支持可读取的 MP4 文件');
      const track = await input.getPrimaryAudioTrack();
      if (!track) throw new AudioExtractionError('no-audio', '视频没有音轨，可继续播放和编辑字幕');
      const config = await track.getDecoderConfig();
      if (!config || typeof AudioDecoder === 'undefined' ||
          !(await AudioDecoder.isConfigSupported(config)).supported || !await track.canDecode()) {
        throw new AudioExtractionError('unsupported', '当前浏览器无法通过 WebCodecs 解码此音轨，可继续播放和编辑字幕');
      }
      const metadata: AudioMetadata = {
        codec: config.codec, sampleRate: config.sampleRate, channels: config.numberOfChannels,
        firstTimestamp: await track.getFirstTimestamp(), endTimestamp: await track.getDurationFromMetadata(),
      };
      if (signal?.aborted) throw aborted();
      return new LocalAudioSource(input, track, metadata, stats);
    } catch (error) {
      input.dispose();
      if (signal?.aborted) throw aborted();
      if (error instanceof AudioExtractionError) throw error;
      throw new AudioExtractionError('unreadable', '无法读取本地视频的音轨，文件可能损坏或不可访问', { cause: error });
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  }

  /** Cumulative physical reads (including prefetch); not a measure of total JS or native memory. */
  get diagnostics() {
    return { bytesRead: this.readStats.bytes, largestRead: this.readStats.largest, readCacheLimit: AUDIO_READ_CACHE_BYTES };
  }

  /** New requests cancel old ones. Consume each chunk synchronously; this class retains no PCM. */
  async readRange(start: number, end: number, consume: (chunk: PcmChunk) => void, signal?: AbortSignal) {
    if (this.input.disposed) throw new AudioExtractionError('disposed', '音频源已释放，请重新打开视频');
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start ||
        end - start > MAX_AUDIO_WINDOW_SECONDS ||
        Math.ceil((end - start) * this.metadata.sampleRate) * this.metadata.channels * 4 > MAX_WINDOW_PCM_BYTES) {
      throw new AudioExtractionError('range', '音频区间须为非负时间，最多 10 秒且 PCM 不超过 16 MiB');
    }
    if (signal?.aborted) throw aborted();
    this.active?.abort();
    const controller = new AbortController();
    this.active = controller;
    const iterator = new AudioSampleSink(this.track).samples(start, end);
    const cancel = () => {
      controller.abort();
      // Mediabunny 1.62.0 return() wakes a pending next() and closes queued samples/decoder.
      void iterator.return();
    };
    const stop = () => { void iterator.return(); };
    controller.signal.addEventListener('abort', stop, { once: true });
    signal?.addEventListener('abort', cancel, { once: true });
    let pcmBytes = 0;
    let chunks = 0;
    const check = () => { if (controller.signal.aborted || signal?.aborted) throw aborted(); };
    try {
      for await (const sample of iterator) {
        try {
          check();
          // Keep only sample frames in [start, end); retain presentation timestamps including gaps/offsets.
          const frameOffset = Math.max(0, Math.ceil((start - sample.timestamp) * sample.sampleRate - 1e-6));
          const frameEnd = Math.min(sample.numberOfFrames, Math.ceil((end - sample.timestamp) * sample.sampleRate - 1e-6));
          const frameCount = frameEnd - frameOffset;
          if (frameCount <= 0) continue;
          pcmBytes += frameCount * sample.numberOfChannels * 4;
          if (pcmBytes > MAX_WINDOW_PCM_BYTES) throw new AudioExtractionError('range', '音频区间 PCM 超过 16 MiB');
          const channels = Array.from({ length: sample.numberOfChannels }, (_, planeIndex) => {
            const data = new Float32Array(frameCount);
            sample.copyTo(data, { format: 'f32-planar', planeIndex, frameOffset, frameCount });
            return data;
          });
          consume({ timestamp: sample.timestamp + frameOffset / sample.sampleRate, sampleRate: sample.sampleRate, channels });
          chunks++;
        } finally {
          sample.close();
        }
      }
      check();
      return { pcmBytes, chunks };
    } catch (error) {
      check();
      if (this.input.disposed) throw new AudioExtractionError('disposed', '音频源已释放');
      if (error instanceof AudioExtractionError) throw error;
      throw new AudioExtractionError('decode', '音频解码或分段读取失败，可继续播放和编辑字幕', { cause: error });
    } finally {
      await iterator.return();
      controller.signal.removeEventListener('abort', stop);
      signal?.removeEventListener('abort', cancel);
      if (this.active === controller) this.active = null;
    }
  }

  dispose() {
    this.active?.abort();
    this.active = null;
    this.input.dispose();
  }
}
