import { useEffect, useMemo, useRef, useState, type RefObject, type ReactNode } from 'react';
import type { Cue } from '../contracts/subtitles';
import type { ProjectStyle } from '../contracts/styles';
import { formatTime } from '../media/playback';
import { orderCues } from '../subtitle-model/cue-order';
import { CueContextMenu, type CueMenuAction } from './CueContextMenu';
import type { SelectionModifiers } from './line-selection';
import type { ShortcutOverrides } from './timing-shortcuts';
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
  selectedIds: readonly string[];
  onSelect: (cue: Cue, modifiers?: SelectionModifiers) => void;
  onContextSelect: (cue: Cue) => void;
  onAction: (action: CueMenuAction) => void;
  editable: boolean;
  hasVideo: boolean;
  shortcutOverrides: ShortcutOverrides;
  searchEnabled: boolean;
  workspace: RefObject<HTMLElement | null>;
  qc?: { open: boolean; label: string; panel: ReactNode; onToggle: () => void; onClose: () => void };
  revealCueId?: { id: string; request: number } | null;
}

export function CueTable({ cues, styles, selectedId, currentTime, selectedIds, onSelect, onContextSelect, onAction, editable, hasVideo, shortcutOverrides, searchEnabled, workspace, qc, revealCueId }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; cueId: string; keyboard: boolean } | null>(null);
  useEffect(() => { if (!searchEnabled || (menu && !cues.some(cue => cue.id === menu.cueId))) setMenu(null); }, [searchEnabled, cues, menu]);
  const closeMenu = () => { setMenu(null); workspace.current?.focus({ preventScroll: true }); };
  const rows = useMemo(() => orderCues(cues).map(cue => ({ cue, cps: cueCps(cue) })), [cues]);
  const [widths, setWidths] = useState(defaultCueColumnWidths);
  const scroll = useRef<HTMLDivElement>(null);
  const rowElements = useRef(new Map<string, HTMLTableRowElement>());
  const pane = useRef<HTMLDivElement>(null);
  function reveal(cueId: string) {
    const container = scroll.current, row = rowElements.current.get(cueId);
    if (!container || !row) return;
    // Scroll this list only; account for its sticky column header.
    const viewport = container.getBoundingClientRect(), target = row.getBoundingClientRect();
    const top = viewport.top + (container.querySelector('thead')?.getBoundingClientRect().height ?? 0);
    if (target.top < top) container.scrollTop += target.top - top;
    else if (target.bottom > viewport.bottom) container.scrollTop += target.bottom - viewport.bottom;
  }
  useEffect(() => { if (revealCueId) reveal(revealCueId.id); }, [revealCueId, qc?.open]);
  const search = useCueSearch({ cues, selectedId, enabled: searchEnabled, workspace, onSelect, onReveal: reveal,
    onShow() { if (pane.current && !pane.current.getClientRects().length) qc?.onClose(); } });
  const highlights = useMemo(() => new Map(search.matches.map(match => [match.cueId, match.ranges])), [search.matches]);
  const handlers = useRef({ onSelect, onContextSelect });
  handlers.current = { onSelect, onContextSelect };
  const selectionKey = JSON.stringify(selectedIds);
  // QC status changes reuse the unchanged table; events still call current handlers.
  const table = useMemo(() => {
    const selectedSet = new Set(selectedIds);
    const names = new Map(styles.map(style => [style.id, style.name]));
    return <table style={{ minWidth: cueTableMinimumWidth(widths) }}>
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
        aria-selected={selectedSet.has(cue.id)}
        onClick={event => handlers.current.onSelect(cue, { ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey })}
        onContextMenu={event => {
          if (!searchEnabled) return;
          event.preventDefault(); handlers.current.onContextSelect(cue);
          setMenu({ x: event.clientX, y: event.clientY, cueId: cue.id, keyboard: false });
        }}
        onKeyDown={event => {
          if (!searchEnabled || !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) return;
          event.preventDefault(); event.stopPropagation(); handlers.current.onContextSelect(cue);
          const rect = event.currentTarget.getBoundingClientRect();
          setMenu({ x: rect.left + 32, y: rect.bottom, cueId: cue.id, keyboard: true });
        }}
        className={`${selectedSet.has(cue.id) ? 'selected' : ''} ${currentTime >= cue.start_ms && currentTime < cue.end_ms ? 'playing' : ''} ${cue.id === search.currentId ? 'search-current' : ''}`}>
        <td><button className="row-number" aria-label={`选择第 ${index + 1} 行`} aria-pressed={cue.id === selectedId}>{index + 1}</button></td>
        <td className="time-cell">{formatTime(cue.start_ms)}</td>
        <td className="time-cell">{formatTime(cue.end_ms)}</td>
        <td className="cps-cell">{cps ?? '—'}</td>
        <td className="style-cell" title={names.get(cue.style_id)}>{names.get(cue.style_id) ?? '未知样式'}</td>
        <td><button className="cue-text"><CueSearchText text={cue.text} ranges={highlights.get(cue.id)} /></button></td>
      </tr>)}</tbody>
    </table>;
  }, [rows, widths, styles, selectedId, selectionKey, currentTime, highlights, search.currentId, searchEnabled]);
  return <section className="cue-list" data-qc-open={qc?.open || undefined}>
    <div className="section-heading"><h2>字幕 <span className="count">{cues.length} 行</span></h2>
      <div className="cue-list-actions"><span title="Ctrl/Cmd 单击多选，Shift 单击连选；右键打开操作">按时间排列</span><button data-cue-search aria-label="查找字幕" aria-expanded={search.open} aria-pressed={search.open}
        disabled={!searchEnabled} onClick={search.toggle}>查找</button>
        {qc && <button data-cue-qc aria-label="字幕质量检查" aria-expanded={qc.open} aria-pressed={qc.open}
          disabled={!searchEnabled} onClick={qc.onToggle}>{qc.label}</button>}</div></div>
    <div className="cue-list-body"><div className="cue-table-pane" ref={pane}>
    {search.open && <CueSearchBar search={search} enabled={searchEnabled} />}
    <div className="table-scroll" ref={scroll}>{table}{!cues.length && <p className="empty">还没有字幕。选好入点和出点，按 G / Enter 提交并开始下一条。</p>}</div>
    </div>{qc?.open && qc.panel}</div>
    {menu && searchEnabled && <CueContextMenu x={menu.x} y={menu.y} keyboard={menu.keyboard} editable={editable} hasVideo={hasVideo} overrides={shortcutOverrides}
      onClose={closeMenu} onAction={onAction} />}
  </section>;
}
