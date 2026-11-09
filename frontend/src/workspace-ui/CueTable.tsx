import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type RefObject, type ReactNode } from 'react';
import type { Cue } from '../contracts/subtitles';
import type { ProjectStyle } from '../contracts/styles';
import { orderCues } from '../subtitle-model/cue-order';
import { CueContextMenu, type CueMenuAction } from './CueContextMenu';
import type { SelectionModifiers } from './line-selection';
import type { ShortcutOverrides } from './timing-shortcuts';
import { useCueSearch } from './use-cue-search';
import { CueSearchBar } from './CueSearchBar';
import { CueRow } from './CueRow';
import { useCueWindow } from './use-cue-window';
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
  const rows = useMemo(() => orderCues(cues), [cues]);
  const [widths, setWidths] = useState(defaultCueColumnWidths);
  const scroll = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const rowWindow = useCueWindow(rows, scroll, JSON.stringify(widths));
  const reveal = rowWindow.reveal;
  useEffect(() => { if (revealCueId) reveal(revealCueId.id); }, [revealCueId, qc?.open]);
  const search = useCueSearch({ cues, selectedId, enabled: searchEnabled, workspace, onSelect, onReveal: reveal,
    onShow() { if (pane.current && !pane.current.getClientRects().length) qc?.onClose(); } });
  const highlights = useMemo(() => new Map(search.matches.map(match => [match.cueId, match.ranges])), [search.matches]);
  const handlers = useRef({ onSelect, onContextSelect });
  handlers.current = { onSelect, onContextSelect };
  const selectRow = useCallback((cue: Cue, modifiers: SelectionModifiers) => handlers.current.onSelect(cue, modifiers), []);
  const openMenu = useCallback((cue: Cue, x: number, y: number, keyboard: boolean) => {
    handlers.current.onContextSelect(cue);
    setMenu({ x, y, cueId: cue.id, keyboard });
  }, []);
  const selectedSet = new Set(selectedIds);
  const names = new Map(styles.map(style => [style.id, style.name]));
  const table = <table style={{ minWidth: cueTableMinimumWidth(widths) }} aria-rowcount={rows.length + 1}
    onFocusCapture={event => rowWindow.onFocus((event.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-cue-id]')?.dataset.cueId ?? null)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) rowWindow.onFocus(null); }}
    onKeyDownCapture={event => {
      if (!rowWindow.enabled || event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement, id = target.closest<HTMLTableRowElement>('tr[data-cue-id]')?.dataset.cueId;
      if (id && target.matches(event.shiftKey ? '.row-number' : '.cue-text') && rowWindow.focusAdjacent(id, event.shiftKey)) event.preventDefault();
    }}>
      <colgroup><col style={{ width: cueRowNumberWidth }} />
        {cueColumns.map(column => <col key={column.id} style={{ width: widths[column.id] }} />)}<col />
      </colgroup>
      <thead><tr><th scope="col">行</th>{cueColumns.map(column => <th key={column.id} scope="col"
        className={column.id === 'cps' ? 'cps-cell' : undefined} aria-label={column.id === 'cps' ? 'CPS（每秒字符数）' : undefined}>
        {column.label}<CueColumnResizeHandle column={column} width={widths[column.id]}
          onResize={width => setWidths(previous => ({ ...previous, [column.id]: clampCueColumnWidth(column, width) }))} />
      </th>)}<th scope="col">字幕文本</th></tr></thead>
      <tbody>{rowWindow.indices.map((index, position) => {
        const cue = rows[index];
        const previousEnd = position ? rowWindow.offsets[rowWindow.indices[position - 1] + 1] : 0;
        const gap = rowWindow.offsets[index] - previousEnd;
        return <Fragment key={cue.id}>
          {gap > 0 && <tr aria-hidden="true" className="cue-spacer"><td colSpan={6} style={{ height: gap }} /></tr>}
          <CueRow cue={cue} number={index + 1}
            registerRow={rowWindow.registerRow} onSelect={selectRow} onMenu={openMenu} menuEnabled={searchEnabled}
            selected={selectedSet.has(cue.id)} primary={cue.id === selectedId}
            playing={currentTime >= cue.start_ms && currentTime < cue.end_ms}
            searchCurrent={cue.id === search.currentId} ranges={highlights.get(cue.id)} styleName={names.get(cue.style_id)} />
        </Fragment>;
      })}{rowWindow.indices.length > 0 && rowWindow.indices.at(-1)! < rows.length - 1 &&
        <tr aria-hidden="true" className="cue-spacer"><td colSpan={6} style={{ height: rowWindow.offsets[rows.length] - rowWindow.offsets[rowWindow.indices.at(-1)! + 1] }} /></tr>}
      </tbody>
    </table>;
  return <section className="cue-list" data-qc-open={qc?.open || undefined}>
    <div className="section-heading"><h2>字幕 <span className="count">{cues.length} 行</span></h2>
      <div className="cue-list-actions"><span title="Ctrl/Cmd 单击多选，Shift 单击连选；右键打开操作">按时间排列</span><button data-cue-search aria-label="查找字幕" aria-expanded={search.open} aria-pressed={search.open}
        disabled={!searchEnabled} onClick={search.toggle}>查找</button>
        {qc && <button data-cue-qc aria-label="字幕质量检查" aria-expanded={qc.open} aria-pressed={qc.open}
          disabled={!searchEnabled} onClick={qc.onToggle}>{qc.label}</button>}</div></div>
    <div className="cue-list-body"><div className="cue-table-pane" ref={pane}>
    {search.open && <CueSearchBar search={search} enabled={searchEnabled} />}
    <div className="table-scroll" ref={scroll} data-windowed={rowWindow.enabled || undefined}>{table}{!cues.length && <p className="empty">还没有字幕。选好入点和出点，按 G / Enter 提交并开始下一条。</p>}</div>
    </div>{qc?.open && qc.panel}</div>
    {menu && searchEnabled && <CueContextMenu x={menu.x} y={menu.y} keyboard={menu.keyboard} editable={editable} hasVideo={hasVideo} overrides={shortcutOverrides}
      onClose={closeMenu} onAction={onAction} />}
  </section>;
}
