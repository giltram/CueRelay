import { useEffect, useId, useRef, useState, type PointerEvent } from 'react';
import type { AuditionState } from '../../media/audio/audition-controller';
import { useAudioAnalysis } from '../../media/audio/use-audio-analysis';
import { formatTime } from '../../media/playback';
import { drawAudio } from './draw-audio';
import { AUDIO_RULER_HEIGHT } from './draw-ruler';
import { boundaryTime, clampViewport, revealInterval, timeAtX, xAtTime, wheelViewport, type AudioViewport } from './viewport';
import './audio-timeline.css';
import type { AudioDisplayMode } from '../../media/audio/analysis-types';
import type { SpectrumImageCache } from './draw-spectrum';
import { AudioBoundary, type BoundaryGesture } from './AudioBoundary';
import { AudioCueIntervals } from './AudioCueIntervals';
import { AudioScrollbar } from './AudioScrollbar';
import type { Cue } from '../../contracts/subtitles';

interface Props {
  historyEpoch?: number;
  onBoundaryGesture?: () => BoundaryGesture;
  file: File | null;
  video: HTMLVideoElement | null;
  duration: number;
  currentTime: number;
  audition?: AuditionState;
  getAuditionPosition?: () => number | null;
  mode: AudioDisplayMode;
  mouseSetsCueBoundary?: boolean;
  selectionId: string | null;
  selection: { start: number; end: number } | null;
  cues: readonly Cue[];
  onSeek: (milliseconds: number) => void;
  onBoundaryChange?: (point: 'start' | 'end', milliseconds: number) => void;
}

type TimelineDrag = { pointerId: number; view: AudioViewport } & (
  | { kind: 'pan'; x: number; moved: boolean; click: 'seek' | 'start' }
  | { kind: 'seek'; grabOffset: number }
);

export function AudioTimeline({ file, video, duration, currentTime, audition, getAuditionPosition, mode, mouseSetsCueBoundary = true, selectionId, selection, cues, onSeek, onBoundaryChange, onBoundaryGesture, historyEpoch }: Props) {
  const auditionTime = audition?.position ?? null;
  const seconds = duration / 1000;
  const stageId = useId();
  const [viewport, setViewport] = useState<AudioViewport>({ start: 0, span: 10 });
  const [verticalZoom, setVerticalZoom] = useState(1);
  const [spectrumImages] = useState<SpectrumImageCache>(() => new WeakMap());
  const view = clampViewport(viewport, seconds);
  const analysis = useAudioAnalysis(file, view.start, view.start + view.span, mode);
  const panel = useRef<HTMLElement>(null);
  const timeDisplay = useRef<HTMLSpanElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const drag = useRef<TimelineDrag | null>(null);
  const [size, setSize] = useState(0);
  const liveView = useRef(view); liveView.current = view;
  const audioPosition = useRef(getAuditionPosition); audioPosition.current = getAuditionPosition;

  useEffect(() => { setViewport({ start: 0, span: 10 }); follow.current = true; drag.current = null; }, [file]);
  useEffect(() => {
    const observer = new ResizeObserver(() => setSize(value => value + 1));
    if (canvas.current) observer.observe(canvas.current);
    // Moving between monitors can change DPR without changing the CSS size.
    let resolution: MediaQueryList;
    const watchResolution = () => {
      resolution?.removeEventListener('change', watchResolution);
      resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      resolution.addEventListener('change', watchResolution);
      setSize(value => value + 1);
    };
    watchResolution();
    return () => { observer.disconnect(); resolution.removeEventListener('change', watchResolution); };
  }, []);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (canvas.current) drawAudio(canvas.current, analysis.tiles, view, mode, spectrumImages, cues, selectionId, selection, verticalZoom);
    });
    return () => cancelAnimationFrame(frame);
  }, [analysis.tiles, view.start, view.span, size, mode, cues, selectionId, selection?.start, selection?.end, verticalZoom]);
  const previousHistoryEpoch = useRef(historyEpoch);
  useEffect(() => {
    if (previousHistoryEpoch.current !== historyEpoch) { previousHistoryEpoch.current = historyEpoch; return; }
    if (!selectionId || !selection) return;
    setViewport(value => revealInterval(value, selection.start / 1000, selection.end / 1000, seconds));
    follow.current = false;
    // Only offscreen selections move the view; typing times never changes zoom/pan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionId, historyEpoch]);
  useEffect(() => {
    if (!video || !seconds) {
      if (playhead.current) playhead.current.hidden = true;
      return;
    }
    let frame = 0;
    const show = (force = false) => {
      const audioTime = audioPosition.current?.() ?? null;
      const current = audioTime === null ? video.currentTime : audioTime / 1000;
      if (timeDisplay.current) timeDisplay.current.textContent = formatTime(current * 1000);
      if (panel.current) {
        if (audioTime === null) delete panel.current.dataset.auditionTime;
        else panel.current.dataset.auditionTime = String(audioTime);
      }
      const visible = liveView.current;
      // Media seeks can round to microseconds; an edge seek must not trigger a pan.
      const outside = current < visible.start - 1e-6 || current > visible.start + visible.span + 1e-6;
      if (drag.current?.kind !== 'seek' && (force || follow.current) && outside) {
        setViewport(value => clampViewport({ ...value, start: current - value.span * 0.15 }, seconds));
      }
      if (playhead.current) {
        const position = xAtTime(current, 100, visible);
        playhead.current.style.left = `${Math.max(0, Math.min(100, position))}%`;
        playhead.current.hidden = !Number.isFinite(position) || outside;
      }
    };
    const tick = () => { show(); frame = requestAnimationFrame(tick); };
    const seeked = () => { follow.current = true; show(true); };
    video.addEventListener('seeked', seeked);
    frame = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(frame); video.removeEventListener('seeked', seeked); };
  }, [video, seconds]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!seconds) return;
      if (drag.current?.kind === 'seek') { event.preventDefault(); return; }
      event.preventDefault(); follow.current = false;
      const rect = element.getBoundingClientRect();
      setViewport(current => wheelViewport(current, event, rect.width, (event.clientX - rect.left) / rect.width, seconds));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [seconds]);

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <section ref={panel} className="audio-panel audio-timeline" aria-label="音频时间轴" data-state={analysis.status}
    data-audition-phase={audition?.phase ?? 'idle'} data-audition-time={auditionTime ?? undefined} data-start={view.start} data-end={view.start + view.span} data-mode={mode} data-cache-bytes={analysis.cacheBytes} data-decoded-segments={analysis.decodedSegments}>
    <div className="audio-visualization">
    <div className="audio-stage" id={stageId} ref={stage} role="group" aria-label="音频可视范围" tabIndex={seconds ? 0 : -1}
      onKeyDown={event => {
        if (drag.current?.kind === 'seek') return;
        if (!seconds || event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault(); follow.current = false;
        setViewport(current => {
          const visible = clampViewport(current, seconds);
          return clampViewport({ ...visible, start: visible.start + (event.key === 'ArrowLeft' ? -1 : 1) * visible.span * 0.2 }, seconds);
        });
      }}
      onPointerDown={event => {
        if (!seconds || drag.current) return;
        const stageRect = event.currentTarget.getBoundingClientRect();
        const inSpectrum = mode === 'spectrum' && event.clientY >= stageRect.top + AUDIO_RULER_HEIGHT;
        if (event.button === 2 && inSpectrum && mouseSetsCueBoundary) {
          // Use fractional PointerEvent coordinates; contextmenu may round them to pixels.
          event.preventDefault(); follow.current = false;
          event.currentTarget.focus({ preventScroll: true });
          onBoundaryChange?.('end', boundaryTime(timeAtX(event.clientX - stageRect.left, stageRect.width, view), duration));
          return;
        }
        if (event.button !== 0) return;
        event.currentTarget.focus({ preventScroll: true });
        const marker = playhead.current;
        if (marker?.contains(event.target as Node)) {
          const rect = marker.getBoundingClientRect();
          // Keep the grabbed point within the 12px hit target, avoiding a jump on press.
          drag.current = { kind: 'seek', pointerId: event.pointerId, view,
            grabOffset: event.clientX - (rect.left + rect.width / 2) };
        } else {
          const click = inSpectrum && mouseSetsCueBoundary ? 'start' : 'seek';
          drag.current = { kind: 'pan', pointerId: event.pointerId, view, x: event.clientX, moved: false, click };
        }
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        const gesture = drag.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (gesture.kind === 'seek') {
          onSeek(Math.min(duration, timeAtX(event.clientX - gesture.grabOffset - rect.left, rect.width, gesture.view) * 1000));
          return;
        }
        const delta = event.clientX - gesture.x;
        if (Math.abs(delta) > 3) gesture.moved = true;
        if (gesture.moved) {
          follow.current = false;
          setViewport({ start: gesture.view.start - delta / rect.width * gesture.view.span, span: gesture.view.span });
        }
      }}
      onPointerUp={event => {
        if (drag.current?.pointerId !== event.pointerId) return;
        if (drag.current.kind === 'pan' && !drag.current.moved) {
          const rect = event.currentTarget.getBoundingClientRect();
          const time = timeAtX(event.clientX - rect.left, rect.width, drag.current.view);
          if (drag.current.click === 'start') {
            follow.current = false;
            onBoundaryChange?.('start', boundaryTime(time, duration));
          } else onSeek(time * 1000);
        }
        endDrag(event);
      }} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
      onContextMenu={event => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (mode !== 'spectrum' || event.clientY < rect.top + AUDIO_RULER_HEIGHT) return;
        event.preventDefault();
      }}>
      <canvas ref={canvas} aria-label={mode === 'waveform' ? '音频波形' : '音频频谱：纵轴频率，颜色越亮能量越强'} />
      <AudioCueIntervals cues={cues} selectedId={selectionId} view={view} />
      {selection && <>
        <AudioBoundary point="start" value={selection.start} duration={duration} view={view} onChange={onBoundaryChange} onGesture={onBoundaryGesture} historyEpoch={historyEpoch} />
        <AudioBoundary point="end" value={selection.end} duration={duration} view={view} onChange={onBoundaryChange} onGesture={onBoundaryGesture} historyEpoch={historyEpoch} />
      </>}
      <div className="audio-playhead" ref={playhead} aria-label="音频播放头" hidden />
      {analysis.status === 'empty' && <p className="audio-message">导入本地视频后显示音频</p>}
      {analysis.status === 'opening' && <p className="audio-message" role="status">正在读取本地音轨…</p>}
      {analysis.status === 'error' && <p className="audio-message audio-error" role="status">{analysis.message}</p>}
    </div>
    <label className="audio-vertical-zoom" title={`垂直缩放 ${verticalZoom.toFixed(2)}× · 向上增强，双击恢复 1.00×`}>
      <input type="range" aria-label="垂直缩放" aria-orientation="vertical" min="0.5" max="4" step="0.01"
        value={verticalZoom} aria-valuetext={`${verticalZoom.toFixed(2)} 倍，${mode === 'spectrum' ? '频谱强度' : '波形高度'}`}
        onChange={event => setVerticalZoom(Number(event.currentTarget.value))}
        onDoubleClick={() => setVerticalZoom(1)} />
    </label>
    </div>
    <AudioScrollbar view={view} duration={seconds} controls={stageId} onScroll={start => {
      if (drag.current?.kind === 'seek') return;
      follow.current = false;
      setViewport(clampViewport({ ...view, start }, seconds));
    }} />
    <div className="audio-footer">
      <span><span ref={timeDisplay}>{formatTime(auditionTime ?? currentTime)}</span>{selection && ` · 入 ${formatTime(selection.start)} / 出 ${formatTime(selection.end)}`}</span>
      <span aria-live="polite">{audition?.message || (analysis.status === 'loading' ? '分析中…' : '滚轮平移 · Shift+滚轮缩放')}</span>
    </div>
  </section>;
}
