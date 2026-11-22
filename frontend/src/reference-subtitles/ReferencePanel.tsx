import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReferenceCue } from '../contracts/projects';
import { t } from '../i18n';
import { useLocale } from '../i18n/react';
import { matchReference, orderReference, referenceContext, type Interval } from './matching';
import './reference.css';

/** Only this leaf samples media; it never writes to a video, editor, or audition session. */
export function ReferencePanel({ id, collapsed, cues, selected, video, currentTime, auditionPlaying, getAuditionPosition, visible }: {
  id: string; collapsed: boolean;
  cues: readonly ReferenceCue[]; selected?: Interval; video: HTMLVideoElement | null; currentTime: number;
  auditionPlaying: boolean; getAuditionPosition: () => number | null; visible: boolean;
}) {
  useLocale();
  const [, tick] = useState(0);
  const content = useRef<HTMLDivElement>(null);
  const ordered = useMemo(() => orderReference(cues), [cues]);
  useEffect(() => {
    if (!visible || collapsed) return;
    let frame = 0;
    const sample = () => {
      tick(value => value + 1);
      if (auditionPlaying || video && !video.paused && !video.ended) frame = requestAnimationFrame(sample);
    };
    const start = () => { cancelAnimationFrame(frame); sample(); };
    video?.addEventListener('play', start); video?.addEventListener('pause', start); video?.addEventListener('ended', start);
    start();
    return () => {
      cancelAnimationFrame(frame);
      video?.removeEventListener('play', start); video?.removeEventListener('pause', start); video?.removeEventListener('ended', start);
    };
  }, [video, visible, collapsed, auditionPlaying]);
  const query = referenceContext(selected, video ? video.currentTime * 1000 : currentTime,
    Boolean(video && !video.paused && !video.ended), auditionPlaying, getAuditionPosition());
  const result = matchReference(ordered, query);
  const key = `${result.before?.sourceIndex}:${result.matches.map(cue => cue.sourceIndex).join(',')}:${result.after?.sourceIndex}`;
  useLayoutEffect(() => {
    const scroll = content.current;
    const current = scroll?.querySelector<HTMLElement>('[data-reference-current], [data-reference-unmatched]');
    if (scroll && current) scroll.scrollTop += current.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 24;
  }, [key, collapsed, cues]);
  const text = (cue: ReferenceCue) => cue.text || t('reference.empty');
  return <section id={id} hidden={collapsed} className="reference-panel" data-reference-subtitles aria-label={t('reference.title')}>
    {!collapsed && <div className="reference-content" ref={content} tabIndex={0}>
      {result.before && <p className="reference-context" data-reference-before>{text(result.before)}</p>}
      {result.matches.length ? result.matches.map(cue => <p className="reference-current" data-reference-current key={cue.sourceIndex}>{text(cue)}</p>)
        : <p className="reference-unmatched" data-reference-unmatched>{t('reference.noMatch')}</p>}
      {result.after && <p className="reference-context" data-reference-after>{text(result.after)}</p>}
    </div>}
  </section>;
}

/** Composed into the media action row by the workspace; media has no reference dependency. */
export function ReferenceToggle({ collapsed, panelId, onToggle }: { collapsed: boolean; panelId: string; onToggle: () => void }) {
  useLocale();
  return <button type="button" className="reference-toggle" data-reference-toggle
    aria-expanded={!collapsed} aria-controls={panelId}
    onMouseDown={event => event.preventDefault()} onClick={onToggle}>
    {t(collapsed ? 'reference.expand' : 'reference.collapse')}
  </button>;
}
