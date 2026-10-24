import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { CueColumn } from './cue-column-widths';

/** Owns only pointer capture; the table owns column widths. */
export function CueColumnResizeHandle({ column, width, onResize }: {
  column: CueColumn; width: number; onResize: (width: number) => void;
}) {
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  const [resizing, setResizing] = useState(false);

  function start(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, width };
    setResizing(true);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    onResize(drag.current.width + event.clientX - drag.current.x);
  }

  function end(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function adjust(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const step = event.shiftKey ? 24 : 8;
    const values: Record<string, number> = {
      ArrowLeft: width - step, ArrowRight: width + step,
      Home: column.minimum, End: column.maximum,
    };
    if (event.key in values) {
      event.preventDefault();
      onResize(values[event.key]);
    }
  }

  return <div className="cue-column-resize" role="separator" tabIndex={0}
    aria-label={`调整${column.label}列宽度`} aria-orientation="vertical"
    aria-valuemin={column.minimum} aria-valuemax={column.maximum} aria-valuenow={Math.round(width)}
    aria-valuetext={`${Math.round(width)} 像素`} data-resizing={resizing || undefined}
    onPointerDown={start} onPointerMove={move} onPointerUp={end}
    onPointerCancel={end} onLostPointerCapture={end} onKeyDown={adjust}
    onDoubleClick={() => onResize(column.defaultWidth)} />;
}
