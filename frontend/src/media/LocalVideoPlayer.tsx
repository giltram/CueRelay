import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { MediaManifest } from '../contracts/projects';
import { hashFile, matchesMedia } from './media-manifest';

interface Props {
  onVideo: (video: HTMLVideoElement | null) => void;
  onTime: (milliseconds: number) => void;
  onDuration: (milliseconds: number) => void;
  onError: (message: string) => void;
  controls: ReactNode;
  expectedMedia?: MediaManifest;
  initialMedia?: { file: File; sha256: string };
  onVerifiedChange?: (verified: boolean) => void;
}

export function LocalVideoPlayer({ onVideo, onTime, onDuration, onError, controls, expectedMedia, initialMedia, onVerifiedChange }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [file, setFile] = useState<File | null>(() => initialMedia && expectedMedia && matchesMedia(initialMedia.file, initialMedia.sha256, expectedMedia) ? initialMedia.file : null);
  const [locked, setLocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState(0);
  const verification = useRef<AbortController | null>(null);
  useEffect(() => () => verification.current?.abort(), []);

  async function chooseFile(picked: File) {
    onVerifiedChange?.(false);
    if (!expectedMedia) { setFile(picked); onError(''); return; }
    if (picked.size !== expectedMedia.size) { onError('片源大小与项目基准不一致，请选择同一视频。'); return; }
    const task = new AbortController(); verification.current?.abort(); verification.current = task;
    setChecking(true); setProgress(0); onError('');
    try {
      const digest = await hashFile(picked, task.signal, setProgress);
      if (!matchesMedia(picked, digest, expectedMedia)) throw new Error('片源 SHA-256 与项目基准不一致，字幕未被修改。');
      if (!task.signal.aborted) setFile(picked);
    } catch (reason) { if (!task.signal.aborted) onError((reason as Error).message); }
    finally { if (verification.current === task) setChecking(false); }
  }

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
    <div className="video-stage">
      <video ref={ref} controls playsInline preload="metadata"
        onLoadedMetadata={e => {
          const duration = e.currentTarget.duration;
          if (!Number.isFinite(duration) || duration <= 0 || duration >= 36000) {
            onError('视频时长无效或超过验证台 10 小时范围，请选择其他文件');
            setLocked(false); setFile(null); onDuration(0); onVerifiedChange?.(false); return;
          }
          setLocked(true); onDuration(duration * 1000); onVerifiedChange?.(true);
        }}
        onTimeUpdate={e => onTime(e.currentTarget.currentTime * 1000)}
        onSeeked={e => onTime(e.currentTarget.currentTime * 1000)}
        onError={() => {
          if (!file) return;
          onVerifiedChange?.(false);
          if (locked) {
            onError('已固定的片源播放中断，可能存在解码或文件读取问题。请先导出字幕，再刷新页面检查；本次会话不能改换片源。');
            onDuration(0);
            return;
          }
          onError('浏览器无法播放这个文件（容器或编码不受支持、文件损坏等）。请保留原件；失败选片可重新选择。');
          setLocked(false); setFile(null); onDuration(0);
        }} />
      {!file && <div className="video-placeholder">导入本地视频<span>视频不会上传</span></div>}
    </div>
    <div className="transport" role="group" aria-label="视频导入与播放控制">
      {controls}
      {checking && <><span role="status">校验 {Math.round(progress * 100)}%</span><button onClick={() => { verification.current?.abort(); setChecking(false); }}>取消校验</button></>}
      <label className="file-picker" title={locked
        ? `片源已固定：${file?.name}。更换前请先导出字幕并刷新页面。`
        : '视频仅在本机播放，不会上传。'}>导入视频
        <input aria-label="导入本地视频" type="file" accept="video/*,.mkv" disabled={locked || checking} onChange={e => {
          const picked = e.target.files?.[0];
          if (picked) void chooseFile(picked);
          e.target.value = '';
        }} />
      </label>
    </div>
  </section>;
}
