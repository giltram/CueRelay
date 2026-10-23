import { useEffect, useRef, useState } from 'react';
import { useAudioAnalysis } from '../../media/audio/use-audio-analysis';
import { formatTime } from '../../media/playback';
import { drawAudio } from './draw-audio';
import { clampViewport, timeAtX, xAtTime, wheelViewport, type AudioViewport } from './viewport';
import './audio-timeline.css';
import type { AudioDisplayMode, SpectrumTile } from '../../media/audio/analysis-types';
import { AudioBoundary } from './AudioBoundary';

interface Props {
  file: File | null;
  video: HTMLVideoElement | null;
  duration: number;
  currentTime: number;
  mode: AudioDisplayMode;
  selectionId: string | null;
  selection: { start: number; end: number } | null;
  onSeek: (milliseconds: number) => void;
  onBoundaryChange?: (point: 'start' | 'end', milliseconds: number) => void;
}

export function AudioTimeline({ file, video, duration, currentTime, mode, selectionId, selection, onSeek, onBoundaryChange }: Props) {
  const seconds = duration / 1000;
  const [viewport, setViewport] = useState<AudioViewport>({ start: 0, span: 10 });
  const [spectrumImages] = useState(() => new WeakMap<SpectrumTile, HTMLCanvasElement>());
  const view = clampViewport(viewport, seconds);
  const analysis = useAudioAnalysis(file, view.start, view.start + view.span, mode);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const playhead = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const drag = useRef<{ x: number; start: number; moved: boolean } | null>(null);
  const [size, setSize] = useState(0);
  const liveView = useRef(view); liveView.current = view;

  useEffect(() => { setViewport({ start: 0, span: 10 }); follow.current = true; }, [file]);
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
    if (canvas.current) drawAudio(canvas.current, analysis.tiles, view, mode, spectrumImages);
  }, [analysis.tiles, view.start, view.span, size, mode]);
  useEffect(() => {
    if (!selectionId || !selection) return;
    setViewport(value => clampViewport({ ...value, start: selection.start / 1000 - value.span * 0.15 }, seconds));
    follow.current = false;
    // Selecting a different subtitle moves the view; typing times never changes the zoom/pan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionId]);
  useEffect(() => {
    if (!video || !seconds) return;
    let frame = 0;
    const show = (force = false) => {
      const current = video.currentTime;
      const visible = liveView.current;
      if ((force || follow.current) && (current < visible.start || current > visible.start + visible.span)) {
        setViewport(value => clampViewport({ ...value, start: current - value.span * 0.15 }, seconds));
      }
      if (playhead.current) {
        const position = xAtTime(current, 100, visible);
        playhead.current.style.left = `${position}%`;
        playhead.current.hidden = !Number.isFinite(position) || position < 0 || position > 100;
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
      event.preventDefault(); follow.current = false;
      const rect = element.getBoundingClientRect();
      setViewport(current => wheelViewport(current, event, rect.width, (event.clientX - rect.left) / rect.width, seconds));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [seconds]);

  return <section className="audio-panel audio-timeline" aria-label="音频时间轴" data-state={analysis.status}
    data-start={view.start} data-end={view.start + view.span} data-mode={mode} data-cache-bytes={analysis.cacheBytes} data-decoded-segments={analysis.decodedSegments}>
    <div className="audio-stage" ref={stage} role="group" aria-label="音频可视范围" tabIndex={seconds ? 0 : -1}
      title="滚轮平移；Shift+滚轮缩放；拖动或方向键平移；单击定位视频"
      onKeyDown={event => {
        if (!seconds || event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault(); follow.current = false;
        setViewport(current => {
          const visible = clampViewport(current, seconds);
          return clampViewport({ ...visible, start: visible.start + (event.key === 'ArrowLeft' ? -1 : 1) * visible.span * 0.2 }, seconds);
        });
      }}
      onPointerDown={event => {
        if (event.button !== 0 || !seconds) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, start: view.start, moved: false };
      }}
      onPointerMove={event => {
        if (!drag.current) return;
        const delta = event.clientX - drag.current.x;
        if (Math.abs(delta) > 3) drag.current.moved = true;
        if (drag.current.moved) {
          follow.current = false;
          setViewport({ start: drag.current.start - delta / event.currentTarget.getBoundingClientRect().width * view.span, span: view.span });
        }
      }}
      onPointerUp={event => {
        if (drag.current && !drag.current.moved) {
          const rect = event.currentTarget.getBoundingClientRect();
          onSeek(timeAtX(event.clientX - rect.left, rect.width, view) * 1000);
        }
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      <canvas ref={canvas} aria-label={mode === 'waveform' ? '音频波形' : '音频频谱：纵轴频率，颜色越深能量越强'} />
      {selection && <>
        <AudioBoundary point="start" value={selection.start} duration={duration} view={view} onChange={onBoundaryChange} />
        <AudioBoundary point="end" value={selection.end} duration={duration} view={view} onChange={onBoundaryChange} />
      </>}
      <div className="audio-playhead" ref={playhead} aria-label="视频播放头" hidden />
      {analysis.status === 'empty' && <p className="audio-message">导入本地视频后显示音频</p>}
      {analysis.status === 'opening' && <p className="audio-message" role="status">正在读取本地音轨…</p>}
      {analysis.status === 'error' && <p className="audio-message audio-error" role="status">{analysis.message}</p>}
    </div>
    <div className="audio-footer">
      <span>{formatTime(currentTime)}{selection && ` · 入 ${formatTime(selection.start)} / 出 ${formatTime(selection.end)}`}</span>
      <span aria-live="polite">{analysis.status === 'loading' ? '分析中…' : '滚轮平移 · Shift+滚轮缩放'}</span>
    </div>
  </section>;
}
