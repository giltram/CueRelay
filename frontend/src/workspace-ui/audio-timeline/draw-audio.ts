import type { AudioDisplayMode, AudioTile } from '../../media/audio/analysis-types';
import type { Cue } from '../../contracts/subtitles';
import { xAtTime, type AudioViewport } from './viewport';
import { drawSpectrum, type SpectrumImageCache } from './draw-spectrum';
import { AUDIO_RULER_HEIGHT, drawRuler } from './draw-ruler';
import { intervalPosition, visibleCueIntervals } from './cue-intervals';
import { spectrumColor, type SpectrumStyle } from './spectrum-pixels';

export function drawAudio(canvas: HTMLCanvasElement, tiles: AudioTile[], view: AudioViewport, mode: AudioDisplayMode,
  spectrumImages: SpectrumImageCache, cues: readonly Cue[], selectedId: string | null,
  selection: { start: number; end: number } | null, verticalZoom = 1) {
  // Preserve fractional CSS dimensions so canvas and percentage-based overlays agree.
  const { width, height } = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const pixelWidth = Math.max(1, Math.round(width * ratio)); const pixelHeight = Math.max(1, Math.round(height * ratio));
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const context = canvas.getContext('2d');
  if (!context || !width || !height) return;
  context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  context.fillStyle = '#08080c'; context.fillRect(0, 0, width, height);
  const top = AUDIO_RULER_HEIGHT; const mid = top + (height - top) / 2; const amplitude = Math.max(1, (height - top) / 2 - 4);
  if (view.span && mode === 'spectrum') for (const tile of tiles) drawSpectrum(context, tile, view, width, height, top, spectrumImages, 'normal', verticalZoom);
  const inactive = visibleCueIntervals(cues, selectedId, view);
  const active = selection ? intervalPosition(selection.start, selection.end, view) : null;
  const paintRegions = (style: SpectrumStyle, regions: readonly { left: number; width: number }[]) => {
    if (!regions.length) return;
    context.save(); context.beginPath();
    // A single clip path forms a union: overlapping subtitles never add brightness.
    for (const region of regions) context.rect(region.left / 100 * width, top, region.width / 100 * width, height - top);
    context.clip();
    context.fillStyle = `rgb(${spectrumColor(0, style).join(',')})`; context.fillRect(0, top, width, height - top);
    if (mode === 'spectrum') for (const tile of tiles) {
      const spectrum = tile.spectrum;
      if (!spectrum) continue;
      const left = xAtTime(spectrum.firstTimestamp - spectrum.stepSeconds / 2, 100, view);
      const right = left + spectrum.columns * spectrum.stepSeconds / view.span * 100;
      if (regions.some(region => left < region.left + region.width && right > region.left)) {
        drawSpectrum(context, tile, view, width, height, top, spectrumImages, style, verticalZoom);
      }
    }
    context.restore();
  };
  paintRegions('inactive', inactive);
  if (active) paintRegions('active', [active]);
  context.strokeStyle = '#27344c'; context.lineWidth = 1;
  if (mode === 'waveform') { context.beginPath(); context.moveTo(0, mid); context.lineTo(width, mid); context.stroke(); }
  context.fillStyle = '#9bbce0'; context.font = '11px ui-monospace, monospace';
  drawRuler(context, view, width, top);
  if (mode === 'spectrum') {
    const spectrum = tiles.find(t => t.spectrum)?.spectrum;
    if (spectrum) {
      context.fillText(`${spectrum.highHz / 1000} kHz`, 3, top + 12);
      context.fillText(`${spectrum.lowHz} Hz`, 3, height - 4);
    }
    return;
  }
  context.strokeStyle = '#81d4fa';
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
    context.moveTo(x + 0.5, mid - Math.min(1, max * verticalZoom) * amplitude);
    context.lineTo(x + 0.5, mid - Math.max(-1, min * verticalZoom) * amplitude);
  }
  context.stroke();
}
