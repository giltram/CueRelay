import { t } from '../i18n';
import { useLocale } from '../i18n/react';
import { Fragment } from 'react';
import type { TextRange } from './cue-search';

/** All source text, including ASS syntax, stays in safe React text nodes. */
export function CueSearchText({ text, ranges = [], current }: { text: string; ranges?: TextRange[]; current?: TextRange }) {
  useLocale();
  if (!text) return <em>{t("workspaceUi.emptyText")}</em>;
  let previousEnd = 0;
  const parts = ranges.map(range => {
    const prefix = text.slice(previousEnd, range.start);
    previousEnd = range.end;
    const start = Math.max(range.start, current?.start ?? range.end);
    const end = Math.min(range.end, current?.end ?? range.start);
    return <Fragment key={range.start}>{prefix}{start < end ? <>
      {range.start < start && <mark>{text.slice(range.start, start)}</mark>}
      <mark className="current-match">{text.slice(start, end)}</mark>
      {end < range.end && <mark>{text.slice(end, range.end)}</mark>}
    </> : <mark>{text.slice(range.start, range.end)}</mark>}</Fragment>;
  });
  return <>{parts}{text.slice(previousEnd)}</>;
}
