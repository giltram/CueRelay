import { describe, expect, it } from 'vitest';
import { formatRulerTime, rulerInterval, rulerLabels, rulerTicks } from './ruler';
import { timeAtX, xAtTime, zoomViewport } from './viewport';

describe('Aegisub ruler intervals', () => {
  it.each([
    [3001, 1, 10], [3000, 10, 100], [301, 10, 100], [300, 100, 1000],
    [225, 100, 1000], [30, 1000, 10_000], [20, 1000, 10_000],
    [3, 10_000, 60_000], [1 / 3, 60_000, 600_000],
    [1 / 9, 600_000, 3_600_000], [1 / 90, 3_600_000, 36_000_000],
  ])('selects the source thresholds at %s px/s', (pps, minorMs, majorMs) => {
    expect(rulerInterval(pps)).toEqual({ minorMs, majorMs });
  });
});

describe('absolute ruler coordinates', () => {
  it('matches the 4.57s / 225px/s reference and generates only visible ticks', () => {
    const view = { start: 4.57, span: 4 };
    const ticks = rulerTicks(view, 900, rulerInterval(225));
    expect(ticks).toHaveLength(40);
    expect(ticks[0].milliseconds).toBe(4600);
    expect(ticks.at(-1)?.milliseconds).toBe(8500);
    const majors = ticks.filter(tick => tick.major);
    expect(majors.map(tick => tick.milliseconds)).toEqual([5000, 6000, 7000, 8000]);
    expect(majors[0].x).toBeCloseTo(96.75);
    expect(rulerLabels(ticks, 1000, 900, text => text.length * 7).map(label => label.text))
      .toEqual(['0:00:05', '06', '07', '08']);
    ticks.slice(1).forEach((tick, i) => expect(tick.x - ticks[i].x).toBeCloseTo(22.5));
  });

  it('keeps an absolute tick grid through pan, zoom, resize and inverse click mapping', () => {
    const original = { start: 4.57, span: 4 };
    const panned = { ...original, start: 4.67 };
    expect(xAtTime(5, 900, panned) - xAtTime(5, 900, original)).toBeCloseTo(-22.5);
    const zoomed = zoomViewport(original, 0.5, 0.3, 120);
    expect(timeAtX(270, 900, original)).toBeCloseTo(timeAtX(270, 900, zoomed));
    for (const view of [original, panned, zoomed, { start: 3600.123456, span: 0.5 }]) {
      for (const width of [320, 900, 2000]) {
        const ticks = rulerTicks(view, width, rulerInterval(width / view.span));
        for (const tick of ticks) {
          expect(tick.x).toBeGreaterThanOrEqual(-1e-7);
          expect(tick.x).toBeLessThanOrEqual(width + 1e-7);
          expect(timeAtX(tick.x, width, view)).toBeCloseTo(tick.milliseconds / 1000, 9);
        }
      }
    }
    expect(xAtTime(5, 1800, original)).toBe(2 * xAtTime(5, 900, original));
  });

  it('does not lose boundary ticks to floating point noise or generate ticks without a viewport', () => {
    const interval = rulerInterval(500);
    expect(rulerTicks({ start: 0.1 + 0.2, span: 1 }, 500, interval)[0].milliseconds).toBe(300);
    expect(rulerTicks({ start: 0, span: 0 }, 500, interval)).toEqual([]);
    expect(rulerTicks({ start: 0, span: 10 }, 0, interval)).toEqual([]);
  });
});

describe('ruler label context and collision handling', () => {
  const labels = (start: number, span: number, pps: number) => {
    const interval = rulerInterval(pps);
    return rulerLabels(rulerTicks({ start, span }, span * pps, interval), interval.majorMs, span * pps, text => text.length * 7);
  };

  it('shows full initial context, then seconds, minutes and hours as needed', () => {
    expect(labels(57.5, 5, 225).map(label => label.text)).toEqual(['0:00:58', '59', '1:00', '01', '02']);
    expect(labels(3597.5, 5, 225).map(label => label.text)).toEqual(['0:59:58', '59', '1:00:00', '01', '02']);
    expect(formatRulerTime(65_000, 1000)).toBe('0:01:05');
    expect(formatRulerTime(3_665_000, 1000)).toBe('1:01:05');
  });

  it('uses tenths at 500px/s and hundredths above 3000px/s with zero padded seconds', () => {
    expect(labels(4.57, 0.6, 500).map(label => label.text)).toEqual(['0:00:04.6', '04.8', '04.9', '05.0', '05.1']);
    expect(formatRulerTime(4610, 10)).toBe('0:00:04.61');
    expect(formatRulerTime(4620, 10, 4610)).toBe('04.62');
    expect(labels(57.5, 35, 20).map(label => label.text)).toEqual(['0:01:00', '10', '20', '30']);
  });

  it('compares prefixes against the last drawn label after skipping across a boundary', () => {
    const ticks = [
      { milliseconds: 59_000, x: 0, major: true },
      { milliseconds: 60_000, x: 40, major: true },
      { milliseconds: 61_000, x: 100, major: true },
    ];
    expect(rulerLabels(ticks, 1000, 200, text => text.length * 10).map(label => label.text))
      .toEqual(['0:00:59', '1:01']);
    ticks[0].milliseconds = 3_599_000; ticks[1].milliseconds = 3_600_000; ticks[2].milliseconds = 3_601_000;
    expect(rulerLabels(ticks, 1000, 200, text => text.length * 10).map(label => label.text))
      .toEqual(['0:59:59', '1:00:01']);
  });

  it('keeps all ticks and omits text that overlaps or would be clipped', () => {
    for (const pps of [0.01, 0.2, 2, 20, 225, 500, 4000]) {
      for (const width of [20, 90, 320, 900]) {
        const interval = rulerInterval(pps);
        const ticks = rulerTicks({ start: 59.031, span: width / pps }, width, interval);
        const before = [...ticks];
        const result = rulerLabels(ticks, interval.majorMs, width, text => text.length * 13);
        expect(ticks).toEqual(before);
        result.forEach((label, i) => {
          expect(label.x + label.width).toBeLessThanOrEqual(width);
          if (i) expect(label.x).toBeGreaterThanOrEqual(result[i - 1].x + result[i - 1].width + 4);
        });
        if (result.length) expect(result[0].text).toMatch(/^\d+:\d{2}:\d{2}/);
      }
    }
  });
});
