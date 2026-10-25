import { useEffect, useState } from 'react';
import type { AssDocument } from '../contracts/subtitles';
import { exportAss } from '../project-data/ass-api';
import { useAssPreview } from './use-ass-preview';

/** Same JASSUB/serializer, with a local black canvas stream instead of a user's video. */
export function StyleSamplePreview({ document }: { document: AssDocument }) {
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState('');
  const preview = useAssPreview(video, stream, document, exportAss, true);
  useEffect(() => {
    if (!video) return;
    const canvas = window.document.createElement('canvas');
    canvas.width = 640; canvas.height = 360;
    const context = canvas.getContext('2d');
    if (!context || !canvas.captureStream) { setError('当前浏览器不支持样式画布预览'); return; }
    context.fillStyle = '#17231f'; context.fillRect(0, 0, canvas.width, canvas.height);
    const media = canvas.captureStream(1);
    let active = true;
    video.srcObject = media; setStream(media);
    void video.play().catch(reason => { if (active) setError(`预览画面无法启动：${reason.message}`); });
    return () => { active = false; video.pause(); video.srcObject = null; media.getTracks().forEach(track => track.stop()); };
  }, [video]);
  return <figure className="style-sample">
    <div className="style-sample-stage"><video ref={setVideo} muted playsInline aria-label="字幕样式效果预览" /></div>
    <figcaption className="hint" role="status">{error || (preview.status.phase === 'error' ? preview.status.message : preview.status.phase === 'ready'
      ? 'ASS 效果预览 · 未提供的字体使用内置 Noto Sans SC，可能与最终成片不同。' : '正在加载 ASS 样式预览…')}</figcaption>
  </figure>;
}
