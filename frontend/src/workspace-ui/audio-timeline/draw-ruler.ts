import { rulerInterval, rulerLabels, rulerTicks } from './ruler';
import type { AudioViewport } from './viewport';

export const AUDIO_RULER_HEIGHT = 22;

/** Draws into the existing audio canvas, sharing its viewport and DPR transform. */
export function drawRuler(context: CanvasRenderingContext2D, view: AudioViewport, width: number, height: number) {
  context.save();
  context.beginPath(); context.rect(0, 0, width, height); context.clip();
  context.fillStyle = '#08080c'; context.fillRect(0, 0, width, height);
  context.fillStyle = '#619eff';
  const transform = context.getTransform();
  const pixelX = 1 / transform.a; const pixelY = 1 / transform.d;
  const bottom = Math.round(height / pixelY) * pixelY;
  context.fillRect(0, bottom - pixelY, width, pixelY);
  if (view.span > 0) {
    const interval = rulerInterval(width / view.span);
    const ticks = rulerTicks(view, width, interval);
    for (const tick of ticks) {
      const x = Math.round(tick.x / pixelX) * pixelX;
      const length = tick.major ? 6 : 4;
      context.fillRect(x, bottom - length, pixelX, length);
    }
    context.font = '11px ui-monospace, monospace';
    context.textAlign = 'left'; context.textBaseline = 'top';
    for (const label of rulerLabels(ticks, interval.majorMs, width, text => context.measureText(text).width)) {
      context.fillText(label.text, label.x, 1);
    }
  }
  context.restore();
}
