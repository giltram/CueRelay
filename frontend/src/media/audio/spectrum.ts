import FFT from 'fft.js';
import type { PcmSegment, SpectrumTile } from './analysis-types';

/** Hann STFT, ~43ms windows / ~11ms hops; averaged channel power avoids phase cancellation. */
export async function analyzeSpectrum(
  segment: PcmSegment, previous: PcmSegment | null, next: PcmSegment | null, signal: AbortSignal,
  yieldControl = () => new Promise<void>(resolve => setTimeout(resolve, 0)),
): Promise<SpectrumTile> {
  const rate = segment.sampleRate;
  const size = Math.max(512, Math.min(8192, 2 ** Math.round(Math.log2(rate * 0.043))));
  const hop = size / 4;
  const frames = segment.channels[0].length;
  // All tiles use one global hop grid; centers are never re-zeroed at segment boundaries.
  const firstFrame = Math.ceil(segment.start * rate / hop) * hop;
  const firstOffset = firstFrame - Math.round(segment.start * rate);
  const columns = Math.ceil((frames - firstOffset) / hop);
  const rows = 128; const lowHz = 80; const highHz = Math.min(8000, rate / 2);
  const energy = new Uint8Array(columns * rows);
  const window = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
  const coherentGain = window.reduce((sum, value) => sum + value, 0);
  const input = new Float64Array(size);
  const output = new Float64Array(size * 2);
  const power = new Float64Array(size / 2 + 1);
  const fft = new FFT(size);
  const maxBin = Math.min(size / 2, Math.ceil(highHz * size / rate));
  for (let column = 0; column < columns; column++) {
    if (column % 16 === 0) { await yieldControl(); signal.throwIfAborted(); }
    power.fill(0);
    const center = firstOffset + column * hop;
    for (let channel = 0; channel < segment.channels.length; channel++) {
      for (let i = 0; i < size; i++) {
        const frame = center + i - size / 2;
        const value = frame < 0 ? previous?.channels[channel]?.[previous.channels[channel].length + frame]
          : frame >= frames ? next?.channels[channel]?.[frame - frames] : segment.channels[channel][frame];
        input[i] = (value || 0) * window[i];
      }
      fft.realTransform(output, input);
      for (let bin = 1; bin <= maxBin; bin++) {
        power[bin] += (output[bin * 2] ** 2 + output[bin * 2 + 1] ** 2) * 4 / coherentGain ** 2 / segment.channels.length;
      }
    }
    for (let row = 0; row < rows; row++) {
      const low = Math.max(1, Math.floor((lowHz + (highHz - lowHz) * row / rows) * size / rate));
      const high = Math.min(maxBin + 1, Math.max(low + 1, Math.ceil((lowHz + (highHz - lowHz) * (row + 1) / rows) * size / rate)));
      let peak = 0;
      for (let bin = low; bin < high; bin++) peak = Math.max(peak, power[bin]);
      const db = 10 * Math.log10(Math.max(1e-12, peak));
      energy[row * columns + column] = Math.round(Math.max(0, Math.min(1, (db + 90) / 75)) * 255);
    }
  }
  signal.throwIfAborted();
  return { firstTimestamp: firstFrame / rate, stepSeconds: hop / rate, columns, rows, lowHz, highHz, energy };
}
