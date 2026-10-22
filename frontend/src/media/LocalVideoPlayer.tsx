import { useEffect, useRef, useState } from 'react';

interface Props {
  onVideo: (video: HTMLVideoElement | null) => void;
  onTime: (milliseconds: number) => void;
  onDuration: (milliseconds: number) => void;
  onError: (message: string) => void;
}

export function LocalVideoPlayer({ onVideo, onTime, onDuration, onError }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [locked, setLocked] = useState(false);

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
    <div className="section-heading"><h2>本地视频</h2><span>媒体始终留在这台设备</span></div>
    <label className="file-picker">{locked ? '本次片源已固定' : '选择本地视频'}
      <input aria-label="选择本地视频" type="file" accept="video/*,.mkv" disabled={locked} onChange={e => {
        const picked = e.target.files?.[0];
        if (picked) { setFile(picked); onError(''); }
        e.target.value = '';
      }} />
    </label>
    <span className="filename">{file?.name || '支持范围以实际解码结果为准'}</span>
    <div className="video-stage">
      <video ref={ref} controls playsInline preload="metadata"
        onLoadedMetadata={e => {
          const duration = e.currentTarget.duration;
          if (!Number.isFinite(duration) || duration <= 0 || duration >= 36000) {
            onError('视频时长无效或超过验证台 10 小时范围，请选择其他文件');
            setLocked(false); setFile(null); onDuration(0); return;
          }
          setLocked(true); onDuration(duration * 1000);
        }}
        onTimeUpdate={e => onTime(e.currentTarget.currentTime * 1000)}
        onSeeked={e => onTime(e.currentTarget.currentTime * 1000)}
        onError={() => {
          if (!file) return;
          if (locked) {
            onError('已固定的片源播放中断，可能存在解码或文件读取问题。请先导出字幕，再刷新页面检查；本次会话不能改换片源。');
            onDuration(0);
            return;
          }
          onError('浏览器无法播放这个文件（容器或编码不受支持、文件损坏等）。请保留原件；失败选片可重新选择。');
          setLocked(false); setFile(null); onDuration(0);
        }} />
      {!file && <div className="video-placeholder">选择视频，开始打轴<span>File → Object URL → 原生 video</span></div>}
    </div>
    <p className="hint">成功加载后本次会话不换片；新片源请先导出字幕，再刷新页面。</p>
  </section>;
}
