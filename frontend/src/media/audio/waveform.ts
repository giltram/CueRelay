import { WAVEFORM_BINS, type PcmSegment } from './analysis-types';

/** Fixed ~0.5ms peak bins in a 2s tile; the renderer combines bins at wider zooms. */
export function waveformPeaks(segment: PcmSegment, bins = WAVEFORM_BINS): Float32Array {
  const peaks = new Float32Array(bins * 2);
  const frames = segment.channels[0]?.length || 0;
  for (let bin = 0; bin < bins; bin++) {
    const start = Math.floor(bin * frames / bins);
    const end = Math.floor((bin + 1) * frames / bins);
    let min = 0; let max = 0;
    for (const channel of segment.channels) for (let frame = start; frame < end; frame++) {
      min = Math.min(min, channel[frame]); max = Math.max(max, channel[frame]);
    }
    peaks[2 * bin] = min; peaks[2 * bin + 1] = max;
  }
  return peaks;
}
