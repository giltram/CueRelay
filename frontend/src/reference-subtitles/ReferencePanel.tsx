import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReferenceCue } from '../contracts/projects';
import { t } from '../i18n';
import { useLocale } from '../i18n/react';
import { matchReference, orderReference, referenceContext, type Interval } from './matching';
import { useReferenceWindow } from './use-reference-window';
import type { ReferenceRow } from './window';
import './reference.css';

/** Only this leaf samples media; it never writes to a video, editor, or audition session. */
export function ReferencePanel({ id, collapsed, cues, selected, video, currentTime, auditionPlaying, getAuditionPosition, visible, locateRequest = 0 }: {
  id: string; collapsed: boolean;
  cues: readonly ReferenceCue[]; selected?: Interval; video: HTMLVideoElement | null; currentTime: number;
  auditionPlaying: boolean; getAuditionPosition: () => number | null; visible: boolean; locateRequest?: number;
}) {
  const locale = useLocale();
  const ordered = useMemo(() => orderReference(cues), [cues]);
  const following = useRef(true);
  const browse = useCallback(() => { following.current = false; }, []);
  const read = () => matchReference(ordered, referenceContext(selected, video ? video.currentTime * 1000 : currentTime,
    Boolean(video && !video.paused && !video.ended), auditionPlaying, getAuditionPosition()));
  const [snapshot, setSnapshot] = useState(() => ({ result: read(), reveal: {} }));
  const latest = useRef(read); latest.current = read;
  const previousKey = useRef('');
  const sample = (locate = false) => {
    if (locate) following.current = true;
    const result = latest.current();
    const key = `${result.before?.sourceIndex}:${result.matches.map(cue => cue.sourceIndex).join(',')}:${result.after?.sourceIndex}`;
    if (!locate && previousKey.current === key) return;
    previousKey.current = key;
    setSnapshot(previous => ({ result, reveal: following.current ? {} : previous.reveal }));
  };
  // Explicit actions restore follow even when the current matching group is unchanged.
  useLayoutEffect(() => {
    if (visible && !collapsed) sample(true);
  }, [cues, visible, collapsed, locateRequest]);
  useLayoutEffect(() => {
    if (!visible || collapsed) return;
    let frame = 0;
    const update = () => {
      if (document.hidden) return;
      sample();
      if (auditionPlaying || video && !video.paused && !video.ended) frame = requestAnimationFrame(update);
    };
    const play = () => { cancelAnimationFrame(frame); sample(true); update(); };
    const stopped = () => { cancelAnimationFrame(frame); update(); };
    video?.addEventListener('play', play); video?.addEventListener('pause', stopped); video?.addEventListener('ended', stopped);
    const visibility = () => { cancelAnimationFrame(frame); update(); };
    document.addEventListener('visibilitychange', visibility);
    if (auditionPlaying) sample(true);
    update();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', visibility);
      video?.removeEventListener('play', play); video?.removeEventListener('pause', stopped); video?.removeEventListener('ended', stopped);
    };
  }, [video, visible, collapsed, auditionPlaying]);
  useLayoutEffect(() => {
    if (visible && !collapsed) sample();
  }, [selected?.start_ms, selected?.end_ms, currentTime, ordered]);

  const { result } = snapshot;
  const gapIndex = result.matches.length ? -1 : result.after ? ordered.indexOf(result.after) : ordered.length;
  const allRows = useMemo(() => ordered.map(cue => ({ key: `cue-${cue.sourceIndex}`, text: cue.text || t('reference.empty') })), [ordered, locale]);
  const rows = useMemo(() => {
    if (gapIndex < 0) return allRows;
    const list: ReferenceRow[] = [...allRows];
    list.splice(gapIndex, 0, { key: 'gap', text: t('reference.noMatch') });
    return list;
  }, [allRows, gapIndex, locale]);
  const matching = useMemo(() => new Set(result.matches.map(cue => `cue-${cue.sourceIndex}`)), [result]);
  const revealKey = result.matches.length ? `cue-${result.matches[0].sourceIndex}` : 'gap';
  return <section id={id} hidden={collapsed} className="reference-panel" data-reference-subtitles aria-label={t('reference.title')}>
    {!collapsed && <ReferenceList rows={rows} referenceRows={allRows} matching={matching} revealKey={revealKey} revealRequest={snapshot.reveal}
      active={visible} onBrowse={browse} />}
  </section>;
}

const ReferenceList = memo(function ReferenceList({ rows, referenceRows, matching, revealKey, revealRequest, active, onBrowse }: {
  rows: readonly ReferenceRow[]; referenceRows: readonly ReferenceRow[]; matching: ReadonlySet<string>; revealKey: string; revealRequest: object;
  active: boolean; onBrowse: () => void;
}) {
  const window = useReferenceWindow(rows, referenceRows, revealKey, revealRequest, active, onBrowse);
  return <div className="reference-content" ref={window.content} tabIndex={0}>
    <div className="reference-window" style={{ height: window.offsets[rows.length] }}>
      {window.indices.map(index => {
        const row = rows[index], current = matching.has(row.key), unmatched = row.key === 'gap';
        return <ReferenceLine key={row.key} row={row} current={current} unmatched={unmatched}
          top={window.offsets[index]} register={window.register} />;
      })}
    </div>
  </div>;
});

const ReferenceLine = memo(function ReferenceLine({ row, current, unmatched, top, register }: {
  row: ReferenceRow; current: boolean; unmatched: boolean; top: number;
  register: (key: string, node: HTMLParagraphElement | null) => void;
}) {
  const ref = useCallback((node: HTMLParagraphElement | null) => register(row.key, node), [register, row.key]);
  return <p ref={ref} style={{ top }} data-reference-row={row.key}
    data-reference-current={current ? '' : undefined} data-reference-unmatched={unmatched ? '' : undefined}
    className={current ? 'reference-current' : unmatched ? 'reference-unmatched' : 'reference-context'}>{row.text}</p>;
});

/** Composed into the media action row by the workspace; media has no reference dependency. */
export function ReferenceToggle({ collapsed, panelId, onToggle }: { collapsed: boolean; panelId: string; onToggle: () => void }) {
  useLocale();
  return <button type="button" className="reference-toggle" data-reference-toggle
    aria-expanded={!collapsed} aria-controls={panelId}
    onMouseDown={event => event.preventDefault()} onClick={onToggle}>
    {t(collapsed ? 'reference.expand' : 'reference.collapse')}
  </button>;
}
