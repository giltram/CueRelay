import type { AudioTile, SpectrumTile } from '../../media/audio/analysis-types';
import { xAtTime, type AudioViewport } from './viewport';
import { colorSpectrumLevels, spectrumLevels, type SpectrumStyle } from './spectrum-pixels';

interface SpectrumImage {
  canvas: HTMLCanvasElement;
  verticalZoom: number;
}
interface SpectrumImages {
  height: number;
  levels: Uint8Array;
  pixels: ImageData;
  variants: Partial<Record<SpectrumStyle, SpectrumImage>>;
}
export type SpectrumImageCache = WeakMap<SpectrumTile, SpectrumImages>;

/** Cached opaque spectrum pixels; coordinates and DPR belong to the existing audio canvas. */
export function drawSpectrum(context: CanvasRenderingContext2D, tile: AudioTile, view: AudioViewport, width: number, height: number, top: number,
  images: SpectrumImageCache, style: SpectrumStyle = 'normal', verticalZoom = 1) {
  const spectrum = tile.spectrum;
  if (!spectrum) return;
  const { columns, firstTimestamp, stepSeconds } = spectrum;
  const pixelHeight = Math.max(1, Math.round((height - top) * context.getTransform().d));
  let cached = images.get(spectrum);
  if (!cached || cached.height !== pixelHeight) {
    cached = { height: pixelHeight, levels: spectrumLevels(spectrum, pixelHeight),
      pixels: context.createImageData(columns, pixelHeight), variants: {} };
    images.set(spectrum, cached);
  }
  let buffer = cached.variants[style];
  if (!buffer) {
    const canvas = document.createElement('canvas'); canvas.width = columns; canvas.height = pixelHeight;
    buffer = { canvas, verticalZoom: NaN };
    cached.variants[style] = buffer;
  }
  if (buffer.verticalZoom !== verticalZoom) {
    // putImageData copies synchronously, so all three palettes share one scratch buffer.
    colorSpectrumLevels(cached.levels, cached.pixels.data, style, verticalZoom);
    buffer.canvas.getContext('2d')!.putImageData(cached.pixels, 0, 0);
    buffer.verticalZoom = verticalZoom;
  }
  const x = xAtTime(firstTimestamp - stepSeconds / 2, width, view);
  context.save();
  // Adjacent tiles share the same hop grid, including the half-hop over their PCM edges.
  context.imageSmoothingEnabled = false;
  context.drawImage(buffer.canvas, x, top, columns * stepSeconds / view.span * width, height - top);
  context.restore();
}
