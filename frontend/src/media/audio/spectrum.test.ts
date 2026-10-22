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
  it('allows cancellation between FFT batches', async () => {
    const controller = new AbortController();
    await expect(analyzeSpectrum(tone(0, 2, 1000), null, null, controller.signal, async () => controller.abort()))
      .rejects.toMatchObject({ name: 'AbortError' });
  });
});
