import { describe, expect, it } from 'vitest';
import { ByteCache } from './byte-cache';
import { waveformPeaks } from './waveform';
import { AudioSegmentStore } from './segment-store';
import { AUDIO_CACHE_BYTES } from './analysis-types';
import type { PcmChunk } from './local-audio';

describe('audio analysis and bounded segment reuse', () => {
  it('keeps short transients and opposite-phase channels in waveform bins', () => {
    const channels = [new Float32Array([0, 0, 1, 0]), new Float32Array([0, 0, -1, 0])];
    expect([...waveformPeaks({ start: 0, end: 2, sampleRate: 2, channels }, 2)]).toEqual([0, 0, -1, 1]);
  });
  it('evicts the least recently used data by bytes and never exceeds its limit', () => {
    const cache = new ByteCache<string>(10);
    cache.put(1, 'one', 4); cache.put(2, 'two', 4);
    expect(cache.get(1)).toBe('one');
    cache.put(3, 'three', 4);
    expect(cache.get(2)).toBeUndefined();
    expect(cache.bytes).toBe(8);
    cache.put(3, 'updated', 8);
    expect(cache.get(1)).toBeUndefined();
    expect(cache.bytes).toBe(8);
    cache.put(4, 'oversized', 11);
    expect(cache.get(4)).toBeUndefined();
    expect(cache.bytes).toBe(8);
  });
  it('retains timestamped gaps and caches decoded PCM without re-decoding', async () => {
    let reads = 0;
    const reader = {
      metadata: { sampleRate: 48000, channels: 1, codec: 'aac', firstTimestamp: 2.5, endTimestamp: 8 },
      readRange: async (_start: number, _end: number, consume: (chunk: PcmChunk) => void) => {
        reads++;
        consume({ timestamp: 2.5, sampleRate: 48000, channels: [new Float32Array(480).fill(0.5)] });
      },
    };
    const store = new AudioSegmentStore(reader);
    const signal = new AbortController().signal;
    const entry = await store.get(1, signal);
    expect(entry.pcm.start).toBe(2);
    expect(entry.pcm.channels[0][23999]).toBe(0);
    expect(entry.pcm.channels[0][24000]).toBe(0.5);
    expect(entry.pcm.channels[0][24480]).toBe(0);
    expect(await store.get(1, signal)).toBe(entry);
    expect(reads).toBe(1);
  });
  it('bounds cache growth across a long sequence of segments', async () => {
    const store = new AudioSegmentStore({
      metadata: { sampleRate: 48000, channels: 2, codec: 'aac', firstTimestamp: 0, endTimestamp: 3600 },
      readRange: async () => {},
    });
    for (let i = 0; i < 80; i++) await store.get(i, new AbortController().signal);
    expect(store.cacheBytes).toBeLessThanOrEqual(AUDIO_CACHE_BYTES);
    expect(store.decodedSegments).toBe(80);
  });
  it('does not cache or deliver a segment canceled during decoding', async () => {
    const controller = new AbortController();
    const store = new AudioSegmentStore({
      metadata: { sampleRate: 48000, channels: 1, codec: 'aac', firstTimestamp: 0, endTimestamp: 8 },
      readRange: async () => { controller.abort(); },
    });
    await expect(store.get(0, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(store.cacheBytes).toBe(0);
  });
  it('reuses cached PCM across modes and charges spectrum bytes to the same budget', async () => {
    let reads = 0;
    const store = new AudioSegmentStore({
      metadata: { sampleRate: 48000, channels: 1, codec: 'aac', firstTimestamp: 0, endTimestamp: 20 },
      readRange: async () => { reads++; },
    });
    const controller = new AbortController();
    const waveform = await store.get(1, controller.signal);
    const bytesBefore = store.cacheBytes;
    const spectrum = await store.withSpectrum(1, controller.signal);
    expect(spectrum).toBe(waveform);
    expect(reads).toBe(3); // Current PCM is reused; only two STFT edge neighbors are fetched.
    expect(spectrum.tile.spectrum!.energy.byteLength).toBeGreaterThan(0);
    expect(store.cacheBytes).toBe(bytesBefore * 3 + spectrum.tile.spectrum!.energy.byteLength);
    await store.withSpectrum(1, controller.signal);
    expect(reads).toBe(3);
    expect(store.cacheBytes).toBeLessThanOrEqual(AUDIO_CACHE_BYTES);
  });
});
