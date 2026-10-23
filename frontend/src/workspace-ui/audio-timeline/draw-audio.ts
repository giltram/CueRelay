import type { AudioDisplayMode, AudioTile, SpectrumTile } from '../../media/audio/analysis-types';
import type { AudioViewport } from './viewport';
import { drawSpectrum } from './draw-spectrum';
import { drawRuler } from './draw-ruler';

export function drawAudio(canvas: HTMLCanvasElement, tiles: AudioTile[], view: AudioViewport, mode: AudioDisplayMode,
  spectrumImages: WeakMap<SpectrumTile, HTMLCanvasElement>) {
  // Preserve fractional CSS dimensions so canvas and percentage-based overlays agree.
  const { width, height } = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
  const context = canvas.getContext('2d');
  if (!context || !width || !height) return;
  context.scale(canvas.width / width, canvas.height / height);
  context.fillStyle = '#f3f5f2'; context.fillRect(0, 0, width, height);
  const top = 22; const mid = top + (height - top) / 2; const amplitude = Math.max(1, (height - top) / 2 - 4);
  if (view.span && mode === 'spectrum') for (const tile of tiles) drawSpectrum(context, tile, view, width, height, top, spectrumImages);
  context.strokeStyle = '#dce3db'; context.lineWidth = 1;
  if (mode === 'waveform') { context.beginPath(); context.moveTo(0, mid); context.lineTo(width, mid); context.stroke(); }
  context.fillStyle = '#63756a'; context.font = '11px ui-monospace, monospace';
  drawRuler(context, view, width, top);
  if (mode === 'spectrum') {
    const high = tiles.find(t => t.spectrum)?.spectrum?.highHz || 8000;
    context.fillStyle = '#63756a';
    context.fillText(`${high / 1000} kHz`, 3, top + 12);
    context.fillText('80 Hz', 3, height - 4);
    return;
  }
  context.strokeStyle = '#265c47';
  context.beginPath();
  // One amplitude span per CSS pixel, combining source peak bins rather than dropping transients.
  for (let x = 0; x < width; x++) {
    const start = view.start + x / width * view.span;
    const end = start + view.span / width;
    let min = 0; let max = 0;
    for (const tile of tiles) {
      if (tile.end <= start || tile.start >= end) continue;
      const bins = tile.peaks.length / 2;
      const first = Math.max(0, Math.floor((start - tile.start) / (tile.end - tile.start) * bins));
      const last = Math.min(bins, Math.ceil((end - tile.start) / (tile.end - tile.start) * bins));
      for (let bin = first; bin < last; bin++) {
        min = Math.min(min, tile.peaks[bin * 2]); max = Math.max(max, tile.peaks[bin * 2 + 1]);
      }
    }
    context.moveTo(x + 0.5, mid - max * amplitude); context.lineTo(x + 0.5, mid - min * amplitude);
  }
  context.stroke();
}
