import { useMemo, useState } from 'react';
import type { Cue } from '../contracts/subtitles';
import { formatTime } from '../media/playback';
import { orderCues } from './cue-order';
import { cueCps } from './cue-cps';
import { CueColumnResizeHandle } from './CueColumnResizeHandle';
import { clampCueColumnWidth, cueColumns, cueRowNumberWidth, cueTableMinimumWidth, defaultCueColumnWidths } from './cue-column-widths';

interface Props {
  cues: Cue[];
  selectedId: string | null;
  currentTime: number;
  onSelect: (cue: Cue) => void;
}

export function CueTable({ cues, selectedId, currentTime, onSelect }: Props) {
  const rows = useMemo(() => orderCues(cues).map(cue => ({ cue, cps: cueCps(cue) })), [cues]);
  const [widths, setWidths] = useState(defaultCueColumnWidths);
  return <section className="cue-list">
    <div className="section-heading"><h2>字幕 <span className="count">{cues.length} 行</span></h2><span>按时间排列</span></div>
    <div className="table-scroll"><table style={{ minWidth: cueTableMinimumWidth(widths) }}>
      <colgroup><col style={{ width: cueRowNumberWidth }} />
        {cueColumns.map(column => <col key={column.id} style={{ width: widths[column.id] }} />)}<col />
      </colgroup>
      <thead><tr><th scope="col">行</th>{cueColumns.map(column => <th key={column.id} scope="col"
        className={column.id === 'cps' ? 'cps-cell' : undefined} aria-label={column.id === 'cps' ? 'CPS（每秒字符数）' : undefined}>
        {column.label}<CueColumnResizeHandle column={column} width={widths[column.id]}
          onResize={width => setWidths(previous => ({ ...previous, [column.id]: clampCueColumnWidth(column, width) }))} />
      </th>)}<th scope="col">字幕文本</th></tr></thead>
      <tbody>{rows.map(({ cue, cps }, index) => <tr key={cue.id}
        className={`${cue.id === selectedId ? 'selected' : ''} ${currentTime >= cue.start_ms && currentTime < cue.end_ms ? 'playing' : ''}`}>
        <td><button className="row-number" aria-label={`选择第 ${index + 1} 行`} aria-pressed={cue.id === selectedId} onClick={() => onSelect(cue)}>{index + 1}</button></td>
        <td className="time-cell">{formatTime(cue.start_ms)}</td>
        <td className="time-cell">{formatTime(cue.end_ms)}</td>
        <td className="cps-cell">{cps ?? '—'}</td>
        <td className="style-cell" title={cue.style}>{cue.style}</td>
        <td><button className="cue-text" onClick={() => onSelect(cue)}>{cue.text || <em>（empty）</em>}</button></td>
      </tr>)}</tbody>
    </table>{!cues.length && <p className="empty">还没有字幕。选好入点和出点，按 G / Enter 提交并开始下一条。</p>}</div>
  </section>;
}
