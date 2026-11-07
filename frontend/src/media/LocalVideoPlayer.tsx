import { diagnostics } from '../diagnostics';
import { HeaderNotice } from '../page-ui/PageLayout';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { MediaManifest } from '../contracts/projects';
import { VideoFilePicker } from './VideoFilePicker';
import { useVideoSource } from './use-video-source';
import type { InitialVideo } from './video-file-access';
import { formatTime } from './playback';

interface Props {
  onVideo: (video: HTMLVideoElement | null) => void;
  onTime: (milliseconds: number) => void;
  onDuration: (milliseconds: number) => void;
  onError: (message: string) => void;
  onFile: (file: File | null) => void;
  currentTime: number;
  duration: number;
  onSeek: (milliseconds: number) => void;
  controls: ReactNode;
  expectedMedia?: MediaManifest;
  initialMedia?: InitialVideo;
  persistenceKey?: string;
  enabled?: boolean;
  onVerifiedChange?: (verified: boolean) => void;
}

export function LocalVideoPlayer({ onVideo, onTime, onDuration, onError, onFile, currentTime, duration, onSeek, controls, expectedMedia, initialMedia, persistenceKey, enabled = true, onVerifiedChange }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const source = useVideoSource({ expectedMedia, initialMedia, persistenceKey, enabled, onError, onVerifiedChange, onDuration });
  const { file, locked, checking, progress } = source;
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === stage.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  useEffect(() => { onFile(file); return () => onFile(null); }, [file, onFile]);

  useEffect(() => {
    const video = ref.current!;
    onVideo(video);
    if (!file) return () => onVideo(null);
    const url = URL.createObjectURL(file);
    video.src = url;
    video.load();
    return () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      onVideo(null);
    };
  }, [file, onVideo]);

  return <section className="player-section">
    <div className="video-stage" ref={stage}>
      <video ref={ref} playsInline preload="metadata"
        onLoadedMetadata={e => {
          diagnostics.record('media', 'load_metadata', 'success');
          source.loaded(e.currentTarget.duration);
        }}
        onTimeUpdate={e => onTime(e.currentTarget.currentTime * 1000)}
        onSeeked={e => onTime(e.currentTarget.currentTime * 1000)}
        onError={() => {
          if (!file) return;
          diagnostics.record('media', 'video_error', 'error', { status: ref.current?.error?.code });
          source.failed(locked
            ? '已固定的片源播放中断，可能存在解码或文件读取问题。请先导出字幕，再刷新页面检查；本次会话不能改换片源。'
            : '浏览器无法播放这个文件（容器或编码不受支持、文件损坏等）。请保留原件；失败选片可重新选择。');
        }} />
      {!file && <div className="video-placeholder">导入本地视频<span>视频不会上传</span></div>}
      {file && <button type="button" className="video-fullscreen" aria-label="切换视频全屏" aria-pressed={fullscreen}
        title={fullscreen ? '退出全屏' : '进入全屏'} onClick={() => {
        if (!stage.current?.requestFullscreen) { onError('当前浏览器无法进入全屏。'); return; }
        const action = document.fullscreenElement ? document.exitFullscreen() : stage.current?.requestFullscreen();
        void action?.catch(() => onError('当前浏览器无法进入全屏。'));
      }}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={fullscreen ? 'M2 6h4V2m4 0v4h4M6 14v-4H2m12 0h-4v4' : 'M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4'} />
      </svg></button>}
    </div>
    <input className="video-progress" type="range" aria-label="视频进度"
      min={0} max={duration || 1} step="any" value={Math.min(currentTime, duration)}
      aria-valuetext={`${formatTime(currentTime)} / ${formatTime(duration)}`}
      disabled={!duration} onChange={event => onSeek(event.currentTarget.valueAsNumber)} />
    <div className="transport" role="group" aria-label="视频导入与播放控制">
      {controls}
      {checking && <HeaderNotice>校验 {Math.round(progress * 100)}%<button onClick={source.cancel}>取消校验</button></HeaderNotice>}
      {source.notice && <HeaderNotice>{source.notice}{source.needsAuthorization &&
        <button disabled={checking || !enabled} onClick={source.authorize}>重新授权视频</button>}</HeaderNotice>}
      <VideoFilePicker label="导入本地视频" disabled={locked || checking || !enabled} remember={Boolean(persistenceKey)}
        onSelect={value => void source.choose(value)} onError={onError} title={locked
          ? `片源已固定：${file?.name}。更换前请先导出字幕并刷新页面。` : undefined}>导入视频</VideoFilePicker>
    </div>
  </section>;
}
