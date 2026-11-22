import type { MessageValue } from '../contracts/messages';
import { t, msg, formatMessage } from "../i18n";
import { useLocale } from "../i18n/react";
import { diagnostics } from '../diagnostics';
import { HeaderNotice } from '../page-ui/PageLayout';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { MediaManifest } from '../contracts/projects';
import { VideoFilePicker } from './VideoFilePicker';
import { useVideoSource } from './use-video-source';
import type { InitialVideo } from './video-file-access';
import { formatTime } from './playback';

interface Props {
  onVideo: (video: HTMLVideoElement | null) => void;
  onTime: (milliseconds: number) => void;
  onDuration: (milliseconds: number) => void;
  onError: (message: MessageValue) => void;
  onFile: (file: File | null) => void;
  currentTime: number;
  duration: number;
  onSeek: (milliseconds: number) => void;
  onTogglePlayback: () => void;
  playbackControls: ReactNode;
  subtitleToggle: ReactNode;
  additionalActions?: ReactNode;
  expectedMedia?: MediaManifest;
  initialMedia?: InitialVideo;
  persistenceKey?: string;
  enabled?: boolean;
  onVerifiedChange?: (verified: boolean) => void;
}

export function LocalVideoPlayer({ onVideo, onTime, onDuration, onError, onFile, currentTime, duration, onSeek, onTogglePlayback, playbackControls, subtitleToggle, additionalActions, expectedMedia, initialMedia, persistenceKey, enabled = true, onVerifiedChange }: Props) {
  useLocale();
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
        onClick={() => {
          if (document.fullscreenElement === stage.current) onTogglePlayback();
        }}
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
            ? t("media.playbackOfTheFixedSourceStoppedPossiblyDue")
            : t("media.theBrowserCannotPlayThisFileUnsupportedContainer"));
        }} />
      {!locked && <div className="video-placeholder">
        <VideoFilePicker label={t("media.importLocalVideo")} disabled={checking || !enabled} remember={Boolean(persistenceKey)}
          onSelect={value => void source.choose(value)} onError={onError}>{t("media.importVideo")}</VideoFilePicker>
        <span>{t("media.videoStaysOnYourDevice")}</span>
      </div>}
      {file && <button type="button" className="video-fullscreen" aria-label={t("media.toggleVideoFullscreen")} aria-pressed={fullscreen}
        title={fullscreen ? t("media.exitFullscreen") : t("media.enterFullscreen")} onClick={() => {
        if (!stage.current?.requestFullscreen) { onError(msg("media.thisBrowserCannotEnterFullscreen")); return; }
        const action = document.fullscreenElement ? document.exitFullscreen() : stage.current?.requestFullscreen();
        void action?.catch(() => onError(msg("media.thisBrowserCannotEnterFullscreen")));
      }}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={fullscreen ? 'M2 6h4V2m4 0v4h4M6 14v-4H2m12 0h-4v4' : 'M6 2H2v4m8-4h4v4M2 10v4h4m8-4v4h-4'} />
      </svg></button>}
    </div>
    <input className="video-progress" type="range" aria-label={t("media.videoPosition")}
      min={0} max={duration || 1} step="any" value={Math.min(currentTime, duration)}
      style={{ '--video-progress': `${duration ? Math.max(0, Math.min(1, currentTime / duration)) * 100 : 0}%` } as CSSProperties}
      aria-valuetext={`${formatTime(currentTime)} / ${formatTime(duration)}`}
      disabled={!duration} onChange={event => onSeek(event.currentTarget.valueAsNumber)} />
    <div className="transport" role="group" aria-label={t("media.videoImportAndPlaybackControls")}>
      {playbackControls}
      {checking && <HeaderNotice>{t("media.verificationProgress", { percent: Math.round(progress * 100) })}<button onClick={source.cancel}>{t("media.cancelVerification")}</button></HeaderNotice>}
      {source.notice && <HeaderNotice>{formatMessage(source.notice)}{source.needsAuthorization &&
        <button disabled={checking || !enabled} onClick={source.authorize}>{t("media.authorizeVideoAgain")}</button>}</HeaderNotice>}
      <div className="transport-actions">
        {additionalActions}
        {subtitleToggle}
      </div>
    </div>
  </section>;
}
