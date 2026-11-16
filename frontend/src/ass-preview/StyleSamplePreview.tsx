import { useMessageState, useLocale } from '../i18n/react';
import { msg, t } from "../i18n";
import { useEffect, useState } from 'react';
import type { AssDocument } from '../contracts/subtitles';
import { exportAss } from '../project-data/ass-api';
import { useAssPreview } from './use-ass-preview';

/** Same JASSUB/serializer, with a local black canvas stream instead of a user's video. */
export function StyleSamplePreview({ document }: { document: AssDocument }) {
  useLocale();
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useMessageState('');
  const preview = useAssPreview(video, stream, document, exportAss, true);
  useEffect(() => {
    if (!video) return;
    const canvas = window.document.createElement('canvas');
    canvas.width = 640; canvas.height = 360;
    const context = canvas.getContext('2d');
    if (!context || !canvas.captureStream) { setError(msg("assPreview.thisBrowserDoesNotSupportTheStylePreview")); return; }
    context.fillStyle = '#17231f'; context.fillRect(0, 0, canvas.width, canvas.height);
    const media = canvas.captureStream(1);
    let active = true;
    video.srcObject = media; setStream(media);
    void video.play().catch(reason => { if (active) setError(msg("assPreview.couldNotStartThePreviewValue", { v0: reason.message })); });
    return () => { active = false; video.pause(); video.srcObject = null; media.getTracks().forEach(track => track.stop()); };
  }, [video]);
  return <figure className="style-sample">
    <div className="style-sample-stage"><video ref={setVideo} muted playsInline aria-label={t("assPreview.subtitleStylePreview")} /></div>
    <figcaption className="hint" role="status">{error || (preview.status.phase === 'error' ? preview.status.message : preview.status.phase === 'ready'
      ? t("assPreview.assPreviewMissingFontsUseTheBundledNoto") : t("assPreview.loadingAssStylePreview"))}</figcaption>
  </figure>;
}
