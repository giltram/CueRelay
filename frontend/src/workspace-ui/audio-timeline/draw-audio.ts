import type { AudioTile } from '../../media/audio/analysis-types';
import { formatTime } from '../../media/playback';
import { rulerStep, type AudioViewport } from './viewport';

export function drawAudio(canvas: HTMLCanvasElement, tiles: AudioTile[], view: AudioViewport) {
  const width = canvas.clientWidth; const height = canvas.clientHeight;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(width * ratio)); canvas.height = Math.max(1, Math.round(height * ratio));
  const context = canvas.getContext('2d');
  if (!context || !view.span) return;
  context.scale(ratio, ratio);
  context.fillStyle = '#f3f5f2'; context.fillRect(0, 0, width, height);
  const top = 22; const mid = top + (height - top) / 2; const amplitude = Math.max(1, (height - top) / 2 - 4);
  context.strokeStyle = '#dce3db'; context.lineWidth = 1;
  context.beginPath(); context.moveTo(0, mid); context.lineTo(width, mid); context.stroke();
  context.fillStyle = '#63756a'; context.font = '11px ui-monospace, monospace';
  const step = rulerStep(view.span);
  for (let time = Math.ceil(view.start / step) * step; time <= view.start + view.span; time += step) {
    const x = (time - view.start) / view.span * width;
    context.fillText(formatTime(time * 1000), Math.min(x + 3, Math.max(0, width - 82)), 14);
    context.strokeStyle = '#dce3db';
    context.beginPath(); context.moveTo(x, 20); context.lineTo(x, height); context.stroke();
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
