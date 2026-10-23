import { describe, expect, it } from 'vitest';
import { analyzeSpectrum } from './spectrum';
import type { PcmSegment, SpectrumTile } from './analysis-types';

const signal = () => new AbortController().signal;
const yieldNow = async () => {};
function tone(start: number, end: number, frequency: number, rate = 48000, opposite = false): PcmSegment {
  const data = Float32Array.from({ length: Math.round((end - start) * rate) }, (_, i) => 0.25 * Math.sin(2 * Math.PI * frequency * (start + i / rate)));
  return { start, end, sampleRate: rate, channels: opposite ? [data, Float32Array.from(data, value => -value)] : [data] };
}
function loudestHz(tile: SpectrumTile, column = Math.floor(tile.columns / 2)) {
  const energy = Array.from({ length: tile.rows }, (_, row) => tile.energy[row * tile.columns + column]);
  const row = energy.indexOf(Math.max(...energy));
  return tile.lowHz + (row + 0.5) / tile.rows * (tile.highHz - tile.lowHz);
}

describe('speech spectrogram STFT', () => {
  it.each([500, 1000, 3000])('places a %sHz tone at its physical frequency', async frequency => {
    const result = await analyzeSpectrum(tone(0, 2, frequency), null, null, signal(), yieldNow);
    expect(Math.abs(loudestHz(result) - frequency)).toBeLessThan(80);
    expect(result.stepSeconds).toBeCloseTo(512 / 48000);
    expect(result.energy.length).toBe(result.columns * result.rows);
  });
  it('does not cancel opposite-phase channels and renders silence with zero energy', async () => {
    const mono = await analyzeSpectrum(tone(0, 2, 1000), null, null, signal(), yieldNow);
    const stereo = await analyzeSpectrum(tone(0, 2, 1000, 48000, true), null, null, signal(), yieldNow);
    expect(stereo.energy).toEqual(mono.energy);
    const quiet = tone(0, 2, 0);
    expect((await analyzeSpectrum(quiet, null, null, signal(), yieldNow)).energy.every(value => value === 0)).toBe(true);
  });
  it('uses a global time grid and real neighboring PCM at segment edges', async () => {
    const previous = tone(0, 2, 1000, 44100);
    const current = tone(2, 4, 1000, 44100);
    const next = tone(4, 6, 1000, 44100);
    const split = await analyzeSpectrum(current, previous, next, signal(), yieldNow);
    const full = await analyzeSpectrum(tone(0, 6, 1000, 44100), null, null, signal(), yieldNow);
    const offset = Math.round((split.firstTimestamp - full.firstTimestamp) / full.stepSeconds);
    for (let row = 0; row < split.rows; row++) {
      expect([...split.energy.subarray(row * split.columns, (row + 1) * split.columns)])
        .toEqual([...full.energy.subarray(row * full.columns + offset, row * full.columns + offset + split.columns)]);
    }
  });
  it('clamps the range to Nyquist at lower sample rates', async () => {
    const result = await analyzeSpectrum(tone(0, 2, 1000, 8000), null, null, signal(), yieldNow);
    expect(result.highHz).toBe(4000);
    expect(Math.abs(loudestHz(result) - 1000)).toBeLessThan(50);
  });
  it('normalizes the Nyquist endpoint like a bin-centered tone of the same peak amplitude', async () => {
    const reference = tone(0, 2, 1000, 8000);
    reference.channels[0] = Float32Array.from(reference.channels[0], value => value / 8);
    const nyquist = { ...reference, channels: [Float32Array.from({ length: 16000 }, (_, i) => (i % 2 ? -1 : 1) / 32)] };
    const peak = (tile: SpectrumTile) => Math.max(...Array.from({ length: tile.rows }, (_, row) => tile.energy[row * tile.columns + 50]));
    const normal = await analyzeSpectrum(reference, null, null, signal(), yieldNow);
    const endpoint = await analyzeSpectrum(nyquist, null, null, signal(), yieldNow);
    expect(Math.abs(peak(normal) - peak(endpoint))).toBeLessThanOrEqual(1);
  });
  it.each([8000, 44100, 48000])('has a fixed calibrated level at %sHz sample rate without per-frame normalization', async rate => {
    const size = rate === 8000 ? 512 : 2048;
    for (const amplitude of [0.5, 0.05, 0.005, 0.00005]) {
      const segment = tone(0, 0.5, rate * 40 / size, rate);
      segment.channels[0] = Float32Array.from(segment.channels[0], value => value * amplitude / 0.25);
      const tile = await analyzeSpectrum(segment, null, null, signal(), yieldNow);
      const column = Math.floor(tile.columns / 2);
      const peak = Math.max(...Array.from({ length: tile.rows }, (_, row) => tile.energy[row * tile.columns + column]));
      const expected = Math.round(Math.max(0, (20 * Math.log10(amplitude) + 80) / 80) * 255);
      expect(Math.abs(peak - expected)).toBeLessThanOrEqual(1);
      expect(tile.lowHz).toBe(0); expect(tile.highHz).toBe(rate / 2);
      expect(tile.rows).toBeLessThanOrEqual(size / 2);
    }
  });
  it('keeps known multiple frequencies, including energy above the former 8kHz cutoff', async () => {
    const frequencies = [937.5, 3000, 12000];
    const channels = [Float32Array.from({ length: 48000 }, (_, i) => frequencies.reduce((sum, hz) => sum + 0.1 * Math.sin(2 * Math.PI * hz * i / 48000), 0))];
    const tile = await analyzeSpectrum({ start: 0, end: 1, sampleRate: 48000, channels }, null, null, signal(), yieldNow);
    const column = Math.floor(tile.columns / 2);
    for (const hz of frequencies) {
      const row = Math.floor(hz / tile.highHz * tile.rows);
      expect(tile.energy[row * tile.columns + column]).toBeGreaterThan(185); // ~-20dBFS, not clipped to white.
    }
    const unused = Math.floor(6000 / tile.highHz * tile.rows);
    expect(tile.energy[unused * tile.columns + column]).toBe(0);
  });
  it('preserves real silence and onset/offset within half a window rather than stretching it through the tile', async () => {
    const segment = tone(0, 2, 1000);
    segment.channels[0].fill(0, 0, 24000); segment.channels[0].fill(0, 48000);
    const tile = await analyzeSpectrum(segment, null, null, signal(), yieldNow);
    for (let column = 0; column < tile.columns; column++) {
      const time = tile.firstTimestamp + column * tile.stepSeconds;
      const peak = Math.max(...Array.from({ length: tile.rows }, (_, row) => tile.energy[row * tile.columns + column]));
      if (time < 0.47 || time > 1.03) expect(peak).toBe(0);
      if (time > 0.53 && time < 0.97) expect(peak).toBeGreaterThan(200);
    }
  });
  it('allows cancellation between FFT batches', async () => {
    const controller = new AbortController();
    await expect(analyzeSpectrum(tone(0, 2, 1000), null, null, controller.signal, async () => controller.abort()))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
});
