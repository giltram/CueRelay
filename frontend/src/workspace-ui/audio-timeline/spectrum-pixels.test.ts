import { describe, expect, it } from 'vitest';
import { spectrumColor, spectrumPixels } from './spectrum-pixels';
import type { SpectrumTile } from '../../media/audio/analysis-types';

function tile(rows: number, columns = 1): SpectrumTile {
  return { firstTimestamp: 0, stepSeconds: 0.01, rows, columns, lowHz: 0, highHz: 24000, energy: new Uint8Array(rows * columns) };
}
const pixel = (data: Uint8ClampedArray, index: number) => [...data.slice(index * 4, index * 4 + 4)];
const luminance = ([r, g, b]: readonly number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

describe('dark spectrum palette and physical frequency pixels', () => {
  it('uses distinct brighter Icy Blue HSL palettes for existing and active intervals', () => {
    expect(spectrumColor(0, 'inactive')).toEqual([32, 24, 40]);
    expect(spectrumColor(0, 'active')).toEqual([64, 32, 96]);
    expect(spectrumColor(255, 'inactive')).toEqual([225, 255, 193]);
    expect(spectrumColor(255, 'active')).toEqual([255, 255, 255]);
    for (const level of [0, 32, 64, 128, 192]) {
      expect(luminance(spectrumColor(level, 'active'))).toBeGreaterThan(luminance(spectrumColor(level, 'inactive')));
      expect(spectrumColor(level, 'normal')).toEqual(spectrumColor(level));
    }
  });
  it('changes only the palette when recoloring the same time-frequency data', () => {
    const spectrum = tile(4, 2);
    spectrum.energy.set([255, 0, 128, 0, 0, 0, 0, 179]);
    const before = spectrum.energy.slice();
    for (const style of ['normal', 'inactive', 'active'] as const) {
      const data = spectrumPixels(spectrum, 4, style);
      expect(pixel(data, 0)).toEqual([...spectrumColor(0, style), 255]);
      expect(pixel(data, 1)).toEqual([...spectrumColor(179, style), 255]);
      expect(pixel(data, 6)).toEqual([...spectrumColor(255, style), 255]);
      expect(spectrum.energy).toEqual(before);
    }
  });
  it('maps silence to near-black and increasing energy to blue, cyan and white with increasing luminance', () => {
    expect(spectrumColor(0)).toEqual([8, 8, 12]);
    expect(spectrumColor(255)).toEqual([255, 255, 255]);
    const blue = spectrumColor(128); expect(blue[2]).toBeGreaterThan(blue[1]); expect(blue[1]).toBeGreaterThan(blue[0]);
    const cyan = spectrumColor(179); expect(cyan[1]).toBeGreaterThan(170); expect(cyan[2]).toBeGreaterThan(220); expect(cyan[0]).toBeLessThan(10);
    for (let i = 1; i < 256; i++) expect(luminance(spectrumColor(i))).toBeGreaterThanOrEqual(luminance(spectrumColor(i - 1)));
  });
  it('is fully opaque, does not alter analysis data, and puts low frequencies at the bottom', () => {
    const spectrum = tile(4, 2);
    spectrum.energy.set([255, 0, 128, 0, 0, 0, 0, 179]);
    const before = spectrum.energy.slice();
    const data = spectrumPixels(spectrum, 4);
    expect(pixel(data, 0)).toEqual([8, 8, 12, 255]); // Top-left: no high frequency energy.
    expect(pixel(data, 1)).toEqual([...spectrumColor(179), 255]);
    expect(pixel(data, 6)).toEqual([255, 255, 255, 255]); // Bottom-left: low frequency tone.
    expect(pixel(data, 7)).toEqual([8, 8, 12, 255]); // Silence remains local to its column.
    expect(spectrum.energy).toEqual(before);
  });
  it('preserves every narrow tone band when reducing rows instead of nearest-neighbor row dropping', () => {
    for (let row = 0; row < 128; row++) {
      const spectrum = tile(128); spectrum.energy[row] = 255;
      const data = spectrumPixels(spectrum, 17);
      expect(Array.from({ length: 17 }, (_, i) => pixel(data, i)).some(color => color[0] === 255)).toBe(true);
    }
  });
  it('interpolates levels at larger heights and rebuilds for different physical pixel counts', () => {
    const spectrum = tile(2); spectrum.energy.set([0, 255]);
    const data = spectrumPixels(spectrum, 4);
    expect(pixel(data, 0)).toEqual([255, 255, 255, 255]);
    expect(pixel(data, 1)).toEqual([...spectrumColor(191.25), 255]);
    expect(pixel(data, 2)).toEqual([...spectrumColor(63.75), 255]);
    expect(pixel(data, 3)).toEqual([8, 8, 12, 255]);
    expect(spectrumPixels(spectrum, 12)).toHaveLength(48);
  });
});
