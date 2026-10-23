import { xAtTime, type AudioViewport } from './viewport';

export interface RulerInterval { minorMs: number; majorMs: number }
export interface RulerTick { milliseconds: number; x: number; major: boolean }
export interface RulerLabel { milliseconds: number; x: number; text: string; width: number }

/** Aegisub 3.2.2 AudioDisplayTimeline::ChangeZoom, with strict > thresholds. */
export function rulerInterval(pixelsPerSecond: number): RulerInterval {
  if (pixelsPerSecond > 3000) return { minorMs: 1, majorMs: 10 };
  if (pixelsPerSecond > 300) return { minorMs: 10, majorMs: 100 };
  if (pixelsPerSecond > 30) return { minorMs: 100, majorMs: 1000 };
  if (pixelsPerSecond > 3) return { minorMs: 1000, majorMs: 10_000 };
  if (pixelsPerSecond > 1 / 3) return { minorMs: 10_000, majorMs: 60_000 };
  if (pixelsPerSecond > 1 / 9) return { minorMs: 60_000, majorMs: 600_000 };
  if (pixelsPerSecond > 1 / 90) return { minorMs: 600_000, majorMs: 3_600_000 };
  return { minorMs: 3_600_000, majorMs: 36_000_000 };
}

/** Integer tick indices avoid cumulative floating point additions while panning. */
export function rulerTicks(view: AudioViewport, width: number, interval: RulerInterval): RulerTick[] {
  if (view.span <= 0 || width <= 0) return [];
  const first = Math.max(0, Math.ceil(view.start * 1000 / interval.minorMs - 1e-9));
  const last = Math.floor((view.start + view.span) * 1000 / interval.minorMs + 1e-9);
  const ticks: RulerTick[] = [];
  for (let index = first; index <= last; index++) {
    const milliseconds = index * interval.minorMs;
    ticks.push({ milliseconds, x: xAtTime(milliseconds / 1000, width, view), major: milliseconds % interval.majorMs === 0 });
  }
  return ticks;
}

/** Context is the previous *drawn* label, never a hidden or clipped candidate. */
export function formatRulerTime(milliseconds: number, majorMs: number, previousMs?: number): string {
  const hour = Math.floor(milliseconds / 3_600_000);
  const minute = Math.floor(milliseconds / 60_000) % 60;
  const second = Math.floor(milliseconds / 1000) % 60;
  let prefix = '';
  if (previousMs === undefined || hour !== Math.floor(previousMs / 3_600_000)) {
    prefix = `${hour}:${String(minute).padStart(2, '0')}:`;
  } else if (Math.floor(milliseconds / 60_000) !== Math.floor(previousMs / 60_000)) {
    prefix = `${minute}:`;
  }
  const precision = majorMs < 100 ? 2 : majorMs < 1000 ? 1 : 0;
  const fraction = precision ? `.${String(milliseconds % 1000).padStart(3, '0').slice(0, precision)}` : '';
  return `${prefix}${String(second).padStart(2, '0')}${fraction}`;
}

export function rulerLabels(ticks: RulerTick[], majorMs: number, width: number,
  measureText: (text: string) => number): RulerLabel[] {
  const labels: RulerLabel[] = [];
  let previousMs: number | undefined;
  let right = -4;
  for (const tick of ticks) {
    if (!tick.major) continue;
    const x = Math.max(0, tick.x); // Only absorbs roundoff at the left boundary.
    const text = formatRulerTime(tick.milliseconds, majorMs, previousMs);
    const textWidth = measureText(text);
    if (x < right + 4 || x + textWidth > width) continue;
    labels.push({ milliseconds: tick.milliseconds, x, text, width: textWidth });
    previousMs = tick.milliseconds;
    right = x + textWidth;
  }
  return labels;
}
