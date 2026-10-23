import { useRef, type PointerEvent } from 'react';
import { formatTime } from '../../media/playback';
import { boundaryTime, timeAtX, xAtTime, type AudioViewport } from './viewport';
import { BoundaryCaps } from './BoundaryCaps';

interface Props {
  point: 'start' | 'end';
  value: number;
  duration: number;
  view: AudioViewport;
  onChange?: (point: 'start' | 'end', milliseconds: number) => void;
}

/** Updates the existing editor draft; the workbench owns validation, commit and row navigation. */
export function AudioBoundary({ point, value, duration, view, onChange }: Props) {
  const drag = useRef<{ pointerId: number; view: AudioViewport; grabOffset: number } | null>(null);
  const position = xAtTime(value / 1000, 100, view);
  if (!view.span || position < 0 || position > 100) return null;
  const name = point === 'start' ? '入点' : '出点';

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    event.stopPropagation(); drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <button type="button" role="slider" className={`audio-boundary ${point}`} style={{ left: `${position}%` }}
    disabled={!onChange} aria-label={`字幕${name} ${formatTime(value)}`} aria-valuemin={0} aria-valuemax={duration}
    aria-valuenow={value} aria-valuetext={formatTime(value)} title={`拖动${name}；方向键微调 10ms，Shift 微调 100ms；G 应用`}
    onPointerDown={event => {
      // A left click on an end marker must reach the stage's start-time action.
      if (event.button !== (point === 'end' ? 2 : 0) || !onChange || drag.current) return;
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.focus({ preventScroll: true });
      const rect = event.currentTarget.getBoundingClientRect();
      drag.current = { pointerId: event.pointerId, view, grabOffset: event.clientX - (rect.left + rect.width / 2) };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const gesture = drag.current;
      if (!gesture || gesture.pointerId !== event.pointerId || !onChange) return;
      event.stopPropagation();
      const rect = event.currentTarget.parentElement!.getBoundingClientRect();
      onChange(point, boundaryTime(timeAtX(event.clientX - gesture.grabOffset - rect.left, rect.width, gesture.view), duration));
    }}
    onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
    onContextMenu={event => {
      if (point === 'end') { event.preventDefault(); event.stopPropagation(); }
    }}
    onKeyDown={event => {
      if (!onChange || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      onChange(point, boundaryTime((value + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 100 : 10)) / 1000, duration));
    }}><BoundaryCaps /><span className="boundary-label">{point === 'start' ? '入' : '出'}</span></button>;
}
