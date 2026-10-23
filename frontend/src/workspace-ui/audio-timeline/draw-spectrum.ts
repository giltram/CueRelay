import type { AudioTile, SpectrumTile } from '../../media/audio/analysis-types';
import { xAtTime, type AudioViewport } from './viewport';
import { spectrumPixels, type SpectrumStyle } from './spectrum-pixels';

export type SpectrumImageCache = WeakMap<SpectrumTile, Partial<Record<SpectrumStyle, HTMLCanvasElement>>>;

/** Cached opaque spectrum pixels; coordinates and DPR belong to the existing audio canvas. */
export function drawSpectrum(context: CanvasRenderingContext2D, tile: AudioTile, view: AudioViewport, width: number, height: number, top: number,
  images: SpectrumImageCache, style: SpectrumStyle = 'normal') {
  const spectrum = tile.spectrum;
  if (!spectrum) return;
  const { columns, firstTimestamp, stepSeconds } = spectrum;
  const pixelHeight = Math.max(1, Math.round((height - top) * context.getTransform().d));
  let variants = images.get(spectrum);
  if (!variants) { variants = {}; images.set(spectrum, variants); }
  let buffer = variants[style];
  if (!buffer || buffer.height !== pixelHeight) {
    const image = context.createImageData(columns, pixelHeight);
    image.data.set(spectrumPixels(spectrum, pixelHeight, style));
    buffer ??= document.createElement('canvas'); buffer.width = columns; buffer.height = pixelHeight;
    buffer.getContext('2d')!.putImageData(image, 0, 0);
    variants[style] = buffer;
  }
  const x = xAtTime(firstTimestamp - stepSeconds / 2, width, view);
  context.save();
  // Adjacent tiles share the same hop grid, including the half-hop over their PCM edges.
  context.imageSmoothingEnabled = false;
  context.drawImage(buffer, x, top, columns * stepSeconds / view.span * width, height - top);
  context.restore();
}
