import type { AudioTile, SpectrumTile } from '../../media/audio/analysis-types';
import { xAtTime, type AudioViewport } from './viewport';

/** Functional energy map using the existing green palette: light silence, dark strong energy. */
export function drawSpectrum(context: CanvasRenderingContext2D, tile: AudioTile, view: AudioViewport, width: number, height: number, top: number,
  images: WeakMap<SpectrumTile, HTMLCanvasElement>) {
  const spectrum = tile.spectrum;
  if (!spectrum) return;
  const { columns, rows, energy, firstTimestamp, stepSeconds } = spectrum;
  let buffer = images.get(spectrum);
  if (!buffer) {
    const image = context.createImageData(columns, rows);
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const level = energy[row * columns + column] / 255;
      const pixel = ((rows - row - 1) * columns + column) * 4;
      image.data[pixel] = Math.round(243 - 227 * level);
      image.data[pixel + 1] = Math.round(245 - 199 * level);
      image.data[pixel + 2] = Math.round(242 - 204 * level);
      image.data[pixel + 3] = 255;
    }
    buffer = document.createElement('canvas'); buffer.width = columns; buffer.height = rows;
    buffer.getContext('2d')!.putImageData(image, 0, 0);
    images.set(spectrum, buffer);
  }
  const x = xAtTime(firstTimestamp - stepSeconds / 2, width, view);
  context.save();
  // Adjacent tiles share the same hop grid, including the half-hop over their PCM edges.
  context.imageSmoothingEnabled = false;
  context.drawImage(buffer, x, top, columns * stepSeconds / view.span * width, height - top);
  context.restore();
}
