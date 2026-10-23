import { useRef } from 'react';
import { formatTime } from '../../media/playback';
import { boundaryTime, timeAtX, xAtTime, type AudioViewport } from './viewport';

interface Props {
  point: 'start' | 'end';
  value: number;
  duration: number;
  view: AudioViewport;
  onChange?: (point: 'start' | 'end', milliseconds: number) => void;
}

/** Updates the existing editor draft; committing still goes through its original applyTimes action. */
export function AudioBoundary({ point, value, duration, view, onChange }: Props) {
  const dragging = useRef(false);
  const position = xAtTime(value / 1000, 100, view);
  if (!view.span || position < 0 || position > 100) return null;
  const name = point === 'start' ? '入点' : '出点';
  return <button type="button" role="slider" className={`audio-boundary ${point}`} style={{ left: `${position}%` }}
    disabled={!onChange} aria-label={`字幕${name} ${formatTime(value)}`} aria-valuemin={0} aria-valuemax={duration}
    aria-valuenow={value} aria-valuetext={formatTime(value)} title={`拖动${name}；方向键微调 10ms，Shift 微调 100ms；G 应用`}
    onPointerDown={event => {
      if (event.button !== 0 || !onChange) return;
      event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); dragging.current = true;
    }}
    onPointerMove={event => {
      if (!dragging.current || !onChange) return;
      event.stopPropagation();
      const rect = event.currentTarget.parentElement!.getBoundingClientRect();
      onChange(point, boundaryTime(timeAtX(event.clientX - rect.left, rect.width, view), duration));
    }}
    onPointerUp={event => {
      event.stopPropagation(); dragging.current = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }} onPointerCancel={() => { dragging.current = false; }} onLostPointerCapture={() => { dragging.current = false; }}
    onKeyDown={event => {
      if (!onChange || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      onChange(point, boundaryTime((value + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 100 : 10)) / 1000, duration));
    }}><span>{point === 'start' ? '入' : '出'}</span></button>;
}
