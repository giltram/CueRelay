import { memo, useMemo, useCallback, type MouseEvent } from 'react';
import type { Cue } from '../contracts/subtitles';
import { formatTime } from '../media/playback';
import { cueCps } from './cue-cps';
import type { TextRange } from './cue-search';
import { CueSearchText } from './CueSearchText';
import type { SelectionModifiers } from './line-selection';

interface Props {
  cue: Cue;
  number: number;
  selected: boolean;
  primary: boolean;
  playing: boolean;
  searchCurrent: boolean;
  styleName: string | undefined;
  ranges: TextRange[] | undefined;
  menuEnabled: boolean;
  registerRow: (id: string, element: HTMLTableRowElement | null) => void;
  onSelect: (cue: Cue, modifiers: SelectionModifiers) => void;
  onMenu: (cue: Cue, x: number, y: number, keyboard: boolean) => void;
}

/** Immutable cue references and per-row flags keep unrelated edits/playback cheap. */
export const CueRow = memo(function CueRow({ cue, number, selected, primary, playing, searchCurrent, styleName,
  ranges, menuEnabled, registerRow, onSelect, onMenu }: Props) {
  const cps = useMemo(() => cueCps(cue), [cue.text, cue.start_ms, cue.end_ms]);
  const ref = useCallback((element: HTMLTableRowElement | null) => registerRow(cue.id, element), [cue.id, registerRow]);
  function select(event: MouseEvent) {
    onSelect(cue, { ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey });
  }
  return <tr ref={ref} data-cue-id={cue.id} aria-rowindex={number + 1} aria-selected={selected} onClick={select}
    onContextMenu={event => {
      if (!menuEnabled) return;
      event.preventDefault(); onMenu(cue, event.clientX, event.clientY, false);
    }}
    onKeyDown={event => {
      if (!menuEnabled || !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return;
      event.preventDefault(); event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      onMenu(cue, rect.left + 32, rect.bottom, true);
    }}
    className={`${selected ? 'selected' : ''} ${playing ? 'playing' : ''} ${searchCurrent ? 'search-current' : ''}`}>
    <td><button className="row-number" aria-label={`选择第 ${number} 行`} aria-pressed={primary}>{number}</button></td>
    <td className="time-cell">{formatTime(cue.start_ms)}</td>
    <td className="time-cell">{formatTime(cue.end_ms)}</td>
    <td className="cps-cell">{cps ?? '—'}</td>
    <td className="style-cell" title={styleName}>{styleName ?? '未知样式'}</td>
    <td><button className="cue-text"><CueSearchText text={cue.text} ranges={ranges} /></button></td>
  </tr>;
});
