import { useMemo, useRef, useState, type RefObject } from 'react';
import type { Cue } from '../contracts/subtitles';
import type { ProjectStyle } from '../contracts/styles';
import { formatTime } from '../media/playback';
import { orderCues } from '../subtitle-model/cue-order';
import { cueCps } from './cue-cps';
import { useCueSearch } from './use-cue-search';
import { CueSearchBar } from './CueSearchBar';
import { CueSearchText } from './CueSearchText';
import { CueColumnResizeHandle } from './CueColumnResizeHandle';
import { clampCueColumnWidth, cueColumns, cueRowNumberWidth, cueTableMinimumWidth, defaultCueColumnWidths } from './cue-column-widths';

interface Props {
  cues: Cue[];
  styles: ProjectStyle[];
  selectedId: string | null;
  currentTime: number;
  onSelect: (cue: Cue) => void;
  searchEnabled: boolean;
  workspace: RefObject<HTMLElement | null>;
}

export function CueTable({ cues, styles, selectedId, currentTime, onSelect, searchEnabled, workspace }: Props) {
  const names = new Map(styles.map(style => [style.id, style.name]));
  const rows = useMemo(() => orderCues(cues).map(cue => ({ cue, cps: cueCps(cue) })), [cues]);
  const [widths, setWidths] = useState(defaultCueColumnWidths);
  const scroll = useRef<HTMLDivElement>(null);
  const rowElements = useRef(new Map<string, HTMLTableRowElement>());
  const search = useCueSearch({ cues, selectedId, enabled: searchEnabled, workspace, onSelect, onReveal(cueId) {
    const container = scroll.current, row = rowElements.current.get(cueId);
    if (!container || !row) return;
    // Scroll this list only; account for its sticky column header.
    const viewport = container.getBoundingClientRect(), target = row.getBoundingClientRect();
    const top = viewport.top + (container.querySelector('thead')?.getBoundingClientRect().height ?? 0);
    if (target.top < top) container.scrollTop += target.top - top;
    else if (target.bottom > viewport.bottom) container.scrollTop += target.bottom - viewport.bottom;
  } });
  const highlights = useMemo(() => new Map(search.matches.map(match => [match.cueId, match.ranges])), [search.matches]);
  return <section className="cue-list">
    <div className="section-heading"><h2>字幕 <span className="count">{cues.length} 行</span></h2>
      <div className="cue-list-actions"><span>按时间排列</span><button data-cue-search aria-label="查找字幕" aria-expanded={search.open} aria-pressed={search.open}
        disabled={!searchEnabled} onClick={search.toggle}>查找</button></div></div>
    {search.open && <CueSearchBar search={search} enabled={searchEnabled} />}
    <div className="table-scroll" ref={scroll}><table style={{ minWidth: cueTableMinimumWidth(widths) }}>
      <colgroup><col style={{ width: cueRowNumberWidth }} />
        {cueColumns.map(column => <col key={column.id} style={{ width: widths[column.id] }} />)}<col />
      </colgroup>
      <thead><tr><th scope="col">行</th>{cueColumns.map(column => <th key={column.id} scope="col"
        className={column.id === 'cps' ? 'cps-cell' : undefined} aria-label={column.id === 'cps' ? 'CPS（每秒字符数）' : undefined}>
        {column.label}<CueColumnResizeHandle column={column} width={widths[column.id]}
          onResize={width => setWidths(previous => ({ ...previous, [column.id]: clampCueColumnWidth(column, width) }))} />
      </th>)}<th scope="col">字幕文本</th></tr></thead>
      <tbody>{rows.map(({ cue, cps }, index) => <tr key={cue.id}
        ref={element => { if (element) rowElements.current.set(cue.id, element); else rowElements.current.delete(cue.id); }}
        className={`${cue.id === selectedId ? 'selected' : ''} ${currentTime >= cue.start_ms && currentTime < cue.end_ms ? 'playing' : ''} ${cue.id === search.currentId ? 'search-current' : ''}`}>
        <td><button className="row-number" aria-label={`选择第 ${index + 1} 行`} aria-pressed={cue.id === selectedId} onClick={() => onSelect(cue)}>{index + 1}</button></td>
        <td className="time-cell">{formatTime(cue.start_ms)}</td>
        <td className="time-cell">{formatTime(cue.end_ms)}</td>
        <td className="cps-cell">{cps ?? '—'}</td>
        <td className="style-cell" title={names.get(cue.style_id)}>{names.get(cue.style_id) ?? '未知样式'}</td>
        <td><button className="cue-text" onClick={() => onSelect(cue)}><CueSearchText text={cue.text} ranges={highlights.get(cue.id)} /></button></td>
      </tr>)}</tbody>
    </table>{!cues.length && <p className="empty">还没有字幕。选好入点和出点，按 G / Enter 提交并开始下一条。</p>}</div>
  </section>;
}
