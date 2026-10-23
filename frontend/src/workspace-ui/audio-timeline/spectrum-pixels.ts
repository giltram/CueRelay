import type { SpectrumTile } from '../../media/audio/analysis-types';

type Rgb = readonly [number, number, number];
export type SpectrumStyle = 'normal' | 'inactive' | 'active';
// Fixed level stops: silence, deep blue, blue, cyan, pale cyan, white.
// Analysis owns the dBFS scale; this module only maps its 0..255 values to pixels.
const stops: readonly { level: number; color: Rgb }[] = [
  { level: 0, color: [8, 8, 12] },
  { level: 0.1, color: [8, 10, 24] },
  { level: 0.3, color: [16, 30, 94] },
  { level: 0.5, color: [24, 72, 190] },
  { level: 0.7, color: [0, 176, 224] },
  { level: 0.85, color: [128, 240, 242] },
  { level: 1, color: [255, 255, 255] },
];
const normalPalette: Rgb[] = Array.from({ length: 256 }, (_, energy) => {
  const level = energy / 255;
  const index = Math.max(1, stops.findIndex(stop => stop.level >= level));
  const from = stops[index - 1]; const to = stops[index];
  const fraction = (level - from.level) / (to.level - from.level);
  const mix = (channel: number) => Math.round(from.color[channel] + fraction * (to.color[channel] - from.color[channel]));
  return [mix(0), mix(1), mix(2)];
});

function hslColor(hue: number, saturation: number, lightness: number): Rgb {
  const h = hue / 255; const s = saturation / 255; const l = Math.min(255, lightness) / 255;
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [channel(0), channel(8), channel(4)];
}

// Aegisub 3.2.2 Icy Blue Inactive / Primary HSL parameters. Keep the existing
// outside-range palette; context styles change only the display, never dBFS.
function contextPalette(active: boolean): Rgb[] {
  return Array.from({ length: 256 }, (_, energy) => {
    const level = energy / 255;
    return hslColor(191 - 128 * level, (active ? 127 : 63) + (active ? 128 : 192) * level,
      (active ? 64 : 32) + 192 * level);
  });
}
const palettes: Record<SpectrumStyle, Rgb[]> = {
  normal: normalPalette, inactive: contextPalette(false), active: contextPalette(true),
};

export function spectrumColor(energy: number, style: SpectrumStyle = 'normal'): Rgb {
  return palettes[style][Math.max(0, Math.min(255, Math.round(energy)))];
}

/** Preserve narrow bands when shrinking; interpolate levels when enlarging. Low Hz is at the bottom. */
export function spectrumPixels(spectrum: SpectrumTile, height: number, style: SpectrumStyle = 'normal'): Uint8ClampedArray {
  const { rows, columns, energy } = spectrum;
  const pixels = new Uint8ClampedArray(columns * height * 4);
  for (let y = 0; y < height; y++) {
    const first = Math.floor(y * rows / height);
    const last = Math.min(rows, Math.ceil((y + 1) * rows / height));
    const position = Math.max(0, Math.min(rows - 1, (y + 0.5) * rows / height - 0.5));
    const lower = Math.floor(position); const upper = Math.min(rows - 1, lower + 1);
    for (let column = 0; column < columns; column++) {
      let level = 0;
      if (height <= rows) {
        for (let row = first; row < last; row++) level = Math.max(level, energy[row * columns + column]);
      } else {
        level = energy[lower * columns + column] * (1 - (position - lower)) + energy[upper * columns + column] * (position - lower);
      }
      const color = spectrumColor(level, style);
      const pixel = ((height - y - 1) * columns + column) * 4;
      pixels[pixel] = color[0]; pixels[pixel + 1] = color[1]; pixels[pixel + 2] = color[2]; pixels[pixel + 3] = 255;
    }
  }
  return pixels;
}
