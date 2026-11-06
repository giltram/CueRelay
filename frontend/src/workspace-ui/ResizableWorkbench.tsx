import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { clampMediaWidth, maximumMediaWidth, mediaWidthBounds, requiredWorkbenchHeight } from './workbench-sizing';

interface Props {
  media: ReactNode;
  editor: ReactNode;
  subtitles: ReactNode;
}

interface Geometry {
  left: number;
  width: number;
  defaultShare: number;
  maximumVideoWidth: number;
  currentVideoWidth: number;
  verticalFrame: number;
  controlsHeight: number;
  height: number;
}

/** Layout state stays here; resizing never changes media or subtitle state. */
export function ResizableWorkbench({ media, editor, subtitles }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const subtitlePane = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const divider = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; offset: number } | null>(null);
  const [geometry, setGeometry] = useState<Geometry | null>(null);
  const [requestedShare, setRequestedShare] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);
  const mediaId = useId();
  const editorId = useId();
  const subtitleId = useId();

  useLayoutEffect(() => {
    const element = root.current!;
    const measure = () => {
      const style = getComputedStyle(element);
      const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const verticalPadding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const dividerWidth = parseFloat(style.getPropertyValue('--divider-width'));
      const controlsHeight = parseFloat(style.getPropertyValue('--video-controls-space'));
      const box = element.getBoundingClientRect();
      const verticalFrame = verticalPadding + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const layoutStyle = getComputedStyle(container.current!);
      const subtitleMinimum = parseFloat(getComputedStyle(subtitlePane.current!).minHeight);
      setGeometry({
        left: box.left + element.clientLeft + parseFloat(style.paddingLeft),
        width: Math.max(0, element.clientWidth - horizontalPadding - dividerWidth),
        defaultShare: parseFloat(style.getPropertyValue('--default-media-share')),
        maximumVideoWidth: maximumMediaWidth(container.current!.clientHeight, subtitleMinimum,
          parseFloat(layoutStyle.rowGap), verticalFrame + controlsHeight),
        currentVideoWidth: Math.max(0, box.height - verticalFrame - controlsHeight) * 16 / 9,
        verticalFrame, controlsHeight, height: box.height,
      });
      // A breakpoint change during a drag must release capture as well.
      if (drag.current && getComputedStyle(divider.current!).display === 'none') {
        if (divider.current!.hasPointerCapture(drag.current.pointerId)) divider.current!.releasePointerCapture(drag.current.pointerId);
        drag.current = null;
        setResizing(false);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(container.current!);
    observer.observe(subtitlePane.current!);
    return () => observer.disconnect();
  }, []);

  const bounds = geometry ? mediaWidthBounds(geometry.width, geometry.maximumVideoWidth) : null;
  const mediaWidth = geometry && bounds
    ? clampMediaWidth(geometry.width * (requestedShare ?? geometry.defaultShare), requestedShare === null
      ? mediaWidthBounds(geometry.width, geometry.currentVideoWidth) : bounds) : 0;
  const percent = (width: number) => geometry?.width ? Math.round(width / geometry.width * 100) : 0;
  const style = geometry?.width
    ? { '--media-share': mediaWidth / geometry.width,
      '--requested-workbench-height': requestedShare === null ? undefined : requiredWorkbenchHeight(mediaWidth, geometry.controlsHeight + geometry.verticalFrame) + 'px',
    } as CSSProperties : undefined;

  function updateWidth(width: number) {
    if (geometry?.width && bounds) setRequestedShare(clampMediaWidth(width, bounds) / geometry.width);
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary || !geometry?.width) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    // Preserve the exact point grabbed within the 16px hit target.
    drag.current = { pointerId: event.pointerId, offset: event.clientX - geometry.left - mediaWidth };
    setResizing(true);
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId || !geometry) return;
    updateWidth(event.clientX - geometry.left - drag.current.offset);
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function adjustWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || !bounds) return;
    const step = event.shiftKey ? 48 : 16;
    const widths: Record<string, number> = {
      ArrowLeft: mediaWidth - step, ArrowRight: mediaWidth + step,
      Home: bounds.minimum, End: bounds.maximum,
    };
    if (event.key in widths) {
      event.preventDefault();
      updateWidth(widths[event.key]);
    }
  }

  return <div className="workbench-layout" ref={container}>
    <div ref={root} className="workbench" style={style} data-resizing={resizing || undefined}>
      <div className="media-panel" id={mediaId}>{media}</div>
      <div ref={divider} className="workbench-divider" role="separator" tabIndex={0}
        aria-label="调整视频区域大小" aria-orientation="vertical" aria-controls={`${mediaId} ${editorId} ${subtitleId}`}
        aria-valuemin={bounds ? percent(bounds.minimum) : 0} aria-valuemax={bounds ? percent(bounds.maximum) : 100}
        aria-valuenow={percent(mediaWidth)} aria-valuetext={`视频区域宽度 ${Math.round(mediaWidth)} 像素，上方区域高度 ${Math.round(geometry?.height ?? 0)} 像素`}
        onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag}
        onPointerCancel={endDrag} onLostPointerCapture={endDrag} onKeyDown={adjustWithKeyboard}
        onDoubleClick={() => setRequestedShare(null)} />
      <div className="editing-panel" id={editorId}>{editor}</div>
    </div>
    <div className="workbench-subtitles" ref={subtitlePane} id={subtitleId}>{subtitles}</div>
  </div>;
}
