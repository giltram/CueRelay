import { Fragment } from 'react';
import type { TextRange } from './cue-search';

/** All source text, including ASS syntax, stays in safe React text nodes. */
export function CueSearchText({ text, ranges = [] }: { text: string; ranges?: TextRange[] }) {
  if (!text) return <em>（empty）</em>;
  let previousEnd = 0;
  const parts = ranges.map(range => {
    const prefix = text.slice(previousEnd, range.start);
    previousEnd = range.end;
    return <Fragment key={range.start}>{prefix}<mark>{text.slice(range.start, range.end)}</mark></Fragment>;
  });
  return <>{parts}{text.slice(previousEnd)}</>;
}
