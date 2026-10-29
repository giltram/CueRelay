import { useRef, type PointerEvent } from 'react';
import { formatTime } from '../../media/playback';
import type { AudioViewport } from './viewport';

interface Props {
  view: AudioViewport;
  duration: number;
  controls: string;
  onScroll: (start: number) => void;
}

/** A controlled scrollbar: AudioTimeline remains the only viewport owner. */
export function AudioScrollbar({ view, duration, controls, onScroll }: Props) {
  const thumb = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; offset: number } | null>(null);
  const maximum = Math.max(0, duration - view.span);
  const progress = maximum ? view.start / maximum : 0;

  function move(event: PointerEvent<HTMLDivElement>, offset: number) {
    const track = event.currentTarget.getBoundingClientRect();
    const travel = track.width - (thumb.current?.getBoundingClientRect().width ?? 0);
    if (travel > 0) onScroll(Math.max(0, Math.min(1, (event.clientX - track.left - offset) / travel)) * maximum);
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <div className="audio-scrollbar" role="scrollbar" aria-label="音频横向滚动"
    aria-orientation="horizontal" aria-controls={controls} aria-valuemin={0} aria-valuemax={maximum}
    aria-valuenow={view.start} aria-valuetext={`${formatTime(view.start * 1000)} – ${formatTime((view.start + view.span) * 1000)}`}
    aria-disabled={!maximum} tabIndex={maximum ? 0 : -1}
    onKeyDown={event => {
      if (!maximum || event.altKey || event.ctrlKey || event.metaKey) return;
      const steps: Record<string, number> = {
        ArrowLeft: view.start - view.span * 0.1, ArrowRight: view.start + view.span * 0.1,
        PageUp: view.start - view.span, PageDown: view.start + view.span, Home: 0, End: maximum,
      };
      if (!(event.key in steps)) return;
      event.preventDefault();
      onScroll(Math.max(0, Math.min(maximum, steps[event.key])));
    }}
    onPointerDown={event => {
      if (event.button !== 0 || !maximum || drag.current || !thumb.current) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      const rect = thumb.current.getBoundingClientRect();
      const onThumb = thumb.current.contains(event.target as Node);
      const offset = onThumb ? event.clientX - rect.left : rect.width / 2;
      drag.current = { pointerId: event.pointerId, offset };
      event.currentTarget.setPointerCapture(event.pointerId);
      if (!onThumb) move(event, offset);
    }}
    onPointerMove={event => {
      if (drag.current?.pointerId === event.pointerId) move(event, drag.current.offset);
    }}
    onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
    <div ref={thumb} className="audio-scrollbar-thumb" style={{
      width: `${duration ? view.span / duration * 100 : 100}%`,
      left: `${progress * 100}%`, transform: `translateX(${-progress * 100}%)`,
    }} />
  </div>;
}
