import type { AudioMetadata, PcmChunk } from './local-audio';
import { AUDIO_CACHE_BYTES, AUDIO_SEGMENT_SECONDS, type AudioTile, type PcmSegment } from './analysis-types';
import { ByteCache } from './byte-cache';
import { waveformPeaks } from './waveform';
import { analyzeSpectrum } from './spectrum';

interface AudioReader {
  metadata: AudioMetadata;
  readRange(start: number, end: number, consume: (chunk: PcmChunk) => void, signal: AbortSignal): Promise<unknown>;
}
export interface AudioSegmentEntry { pcm: PcmSegment; tile: AudioTile }

/** Owns decoded segments and analysis in one byte-bounded cache, local to a file's Worker. */
export class AudioSegmentStore {
  private cache = new ByteCache<AudioSegmentEntry>(AUDIO_CACHE_BYTES);
  decodedSegments = 0;
  get cacheBytes() { return this.cache.bytes; }
  constructor(private reader: AudioReader) {}

  async withSpectrum(index: number, signal: AbortSignal): Promise<AudioSegmentEntry> {
    const entry = await this.get(index, signal);
    if (!entry.tile.spectrum) {
      const previous = index > 0 ? (await this.get(index - 1, signal)).pcm : null;
      const next = (await this.get(index + 1, signal)).pcm;
      const spectrum = await analyzeSpectrum(entry.pcm, previous, next, signal);
      signal.throwIfAborted();
      entry.tile.spectrum = spectrum;
      this.cache.put(index, entry, entry.pcm.channels.reduce((sum, data) => sum + data.byteLength, 0) +
        entry.tile.peaks.byteLength + spectrum.energy.byteLength);
    }
    return entry;
  }

  async get(index: number, signal: AbortSignal): Promise<AudioSegmentEntry> {
    signal.throwIfAborted();
    const cached = this.cache.get(index);
    if (cached) return cached;
    const start = index * AUDIO_SEGMENT_SECONDS;
    const end = start + AUDIO_SEGMENT_SECONDS;
    const { sampleRate, channels: channelCount } = this.reader.metadata;
    const frames = Math.ceil((end - start) * sampleRate);
    if (frames * channelCount * 4 > 16 * 1024 * 1024) throw Error('音轨采样率或声道数过大，无法在安全内存预算内分析');
    const pcm: PcmSegment = { start, end, sampleRate,
      channels: Array.from({ length: channelCount }, () => new Float32Array(frames)) };
    await this.reader.readRange(start, end, chunk => {
      signal.throwIfAborted();
      if (chunk.sampleRate !== sampleRate || chunk.channels.length !== channelCount) throw Error('音轨中途改变采样格式，暂无法分析');
      const offset = Math.round((chunk.timestamp - start) * sampleRate);
      for (let channel = 0; channel < channelCount; channel++) {
        const from = Math.max(0, -offset);
        const count = Math.min(chunk.channels[channel].length - from, frames - Math.max(0, offset));
        if (count > 0) pcm.channels[channel].set(chunk.channels[channel].subarray(from, from + count), Math.max(0, offset));
      }
    }, signal);
    signal.throwIfAborted();
    const entry = { pcm, tile: { start, end, peaks: waveformPeaks(pcm) } };
    this.decodedSegments++;
    this.cache.put(index, entry, entry.tile.peaks.byteLength + frames * channelCount * 4);
    return entry;
  }
}
