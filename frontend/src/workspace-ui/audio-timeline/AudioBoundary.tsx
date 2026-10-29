import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { formatTime } from '../../media/playback';
import { boundaryTime, timeAtX, xAtTime, type AudioViewport } from './viewport';
import { BoundaryCaps } from './BoundaryCaps';

export interface BoundaryGesture {
  change: (point: 'start' | 'end', milliseconds: number) => void;
  end: () => void;
}
interface Props {
  point: 'start' | 'end';
  historyEpoch?: number;
  onGesture?: () => BoundaryGesture;
  value: number;
  duration: number;
  view: AudioViewport;
  onChange?: (point: 'start' | 'end', milliseconds: number) => void;
}

/** Updates the existing editor draft; the workbench owns validation, commit and row navigation. */
export function AudioBoundary({ point, value, duration, view, onChange, onGesture, historyEpoch }: Props) {
  const drag = useRef<{ pointerId: number; view: AudioViewport; grabOffset: number; gesture?: BoundaryGesture } | null>(null);
  const keys = useRef<{ code: string; gesture?: BoundaryGesture } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  function finish() {
    drag.current?.gesture?.end(); keys.current?.gesture?.end();
    const pointer = drag.current?.pointerId;
    drag.current = null; keys.current = null;
    if (pointer !== undefined && button.current?.hasPointerCapture(pointer)) button.current.releasePointerCapture(pointer);
  }
  useEffect(() => {
    const release = (event: KeyboardEvent) => { if (event.code === keys.current?.code) finish(); };
    window.addEventListener('keyup', release); window.addEventListener('blur', finish);
    return () => { finish(); window.removeEventListener('keyup', release); window.removeEventListener('blur', finish); };
  }, []);
  useEffect(() => { finish(); }, [historyEpoch, Boolean(onChange)]);
  const [pointerFocused, setPointerFocused] = useState(false);
  const position = xAtTime(value / 1000, 100, view);
  if (!view.span || position < 0 || position > 100) return null;
  const name = point === 'start' ? '入点' : '出点';

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    event.stopPropagation(); finish();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <button ref={button} type="button" role="slider" className={`audio-boundary ${point}`} style={{ left: `${position}%` }}
    data-pointer-focus={pointerFocused || undefined} onBlur={() => { setPointerFocused(false); finish(); }}
    disabled={!onChange} aria-label={`字幕${name} ${formatTime(value)}`} aria-valuemin={0} aria-valuemax={duration}
    aria-valuenow={value} aria-valuetext={formatTime(value)} title={`拖动${name}；方向键微调 10ms，Shift 微调 100ms；G 应用`}
    onPointerDown={event => {
      // A left click on an end marker must reach the stage's start-time action.
      if (event.button !== (point === 'end' ? 2 : 0) || !onChange || drag.current) return;
      event.preventDefault(); event.stopPropagation();
      // Explicit focus can inherit :focus-visible from the previous keyboard/input focus.
      setPointerFocused(true);
      event.currentTarget.focus({ preventScroll: true });
      const rect = event.currentTarget.getBoundingClientRect();
      finish();
      drag.current = { gesture: onGesture?.(), pointerId: event.pointerId, view, grabOffset: event.clientX - (rect.left + rect.width / 2) };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const gesture = drag.current;
      if (!gesture || gesture.pointerId !== event.pointerId || !onChange) return;
      event.stopPropagation();
      const rect = event.currentTarget.parentElement!.getBoundingClientRect();
      (gesture.gesture?.change ?? onChange)(point, boundaryTime(timeAtX(event.clientX - gesture.grabOffset - rect.left, rect.width, gesture.view), duration));
    }}
    onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
    onContextMenu={event => {
      if (point === 'end') { event.preventDefault(); event.stopPropagation(); }
    }}
    onKeyDown={event => {
      setPointerFocused(false);
      if (!onChange || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (event.repeat && !keys.current) return;
      if (!event.repeat || keys.current?.code !== event.code) {
        finish(); keys.current = { code: event.code, gesture: onGesture?.() };
      }
      (keys.current?.gesture?.change ?? onChange)(point, boundaryTime((value + (event.key === 'ArrowLeft' ? -1 : 1) * (event.shiftKey ? 100 : 10)) / 1000, duration));
    }}><BoundaryCaps /><span className="boundary-label">{point === 'start' ? '入' : '出'}</span></button>;
}
