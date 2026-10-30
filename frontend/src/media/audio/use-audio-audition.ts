import { diagnostics, safeError } from '../../diagnostics';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaybackRange } from '../playback';
import { AudioAuditionController, type AuditionState } from './audition-controller';
import { WorkerAuditionReader } from './audition-reader';

const idle: AuditionState = { phase: 'idle', position: null, message: '' };

/** Connect the independent audio session to media/navigation lifecycle, never to analysis requests. */
export function useAudioAudition(file: File | null, video: HTMLVideoElement | null, visible: boolean) {
  const controller = useRef<AudioAuditionController | null>(null);
  const pendingSeek = useRef<number | null>(null);
  const [state, setState] = useState<AuditionState>(idle);
  useEffect(() => {
    setState(idle);
    if (!file || !video || !visible) return;
    const scope = diagnostics.scope(), context = diagnostics.contextSnapshot();
    let displayed = idle;
    const changed = (next: AuditionState) => {
      // Frame-by-frame position is read directly by the timeline; do not rerender the subtitle table.
      if (displayed.phase === next.phase && displayed.message === next.message &&
          (next.phase === 'playing' || displayed.position === next.position)) return;
      if (displayed.phase !== next.phase || displayed.message !== next.message) diagnostics.record('audio-audition', 'phase', next.phase === 'error' ? 'error' : next.phase === 'idle' ? 'cancelled' : 'success', { reason: next.phase, ...(next.phase === 'error' ? { error: safeError(new Error()) } : {}) }, scope, context);
      displayed = next; setState(next);
    };
    const create = () => new AudioAuditionController(() => new WorkerAuditionReader(file), changed);
    let instance = create();
    controller.current = instance;
    // Cover native/programmatic video actions in addition to the workbench's synchronous cancellation.
    const stop = () => { pendingSeek.current = null; instance.stop(); };
    const play = () => { if (!video.paused) stop(); };
    const seeking = () => {
      // A seek already in progress at keydown can dispatch its event AFTER audition preparation.
      // Accept only that pending seek at the captured position; subsequent/new seeks still cancel.
      const expected = pendingSeek.current; pendingSeek.current = null;
      if (expected !== null && video.currentTime === expected) return;
      stop();
    };
    const seeked = () => { pendingSeek.current = null; };
    video.addEventListener('play', play);
    video.addEventListener('seeking', seeking);
    video.addEventListener('seeked', seeked);
    video.addEventListener('emptied', stop);
    video.addEventListener('error', stop);
    const pagehide = () => { instance.dispose(); controller.current = null; displayed = idle; setState(idle); };
    const pageshow = () => {
      if (controller.current) return;
      instance = create(); controller.current = instance;
    };
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('pageshow', pageshow);
    return () => {
      controller.current = null; pendingSeek.current = null; instance.dispose();
      video.removeEventListener('play', play);
      video.removeEventListener('seeking', seeking);
      video.removeEventListener('seeked', seeked);
      video.removeEventListener('emptied', stop);
      video.removeEventListener('error', stop);
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('pageshow', pageshow);
    };
  }, [file, video, visible]);
  const stop = useCallback(() => { pendingSeek.current = null; controller.current?.stop(); }, []);
  const getPosition = useCallback(() => controller.current?.getPosition() ?? null, []);
  const start = useCallback(async (range: PlaybackRange | null) => {
    if (!video || !controller.current) throw Error('请先加载可播放的本地视频');
    pendingSeek.current = video.seeking ? video.currentTime : null;
    video.pause();
    if (range) { diagnostics.record('audio-audition', 'start', 'start'); await controller.current.start(range); } else controller.current.stop();
  }, [video]);
  return { state, start, stop, getPosition };
}
