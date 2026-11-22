import { formatMessage, t } from '../i18n';
import { useLocale } from "../i18n/react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type RefObject, type ReactNode } from 'react';
import type { Cue } from '../contracts/subtitles';
import type { ProjectStyle } from '../contracts/styles';
import { orderCues } from '../subtitle-model/cue-order';
import { CueContextMenu, type CueMenuAction } from './CueContextMenu';
import type { SelectionModifiers } from './line-selection';
import type { ShortcutOverrides } from './timing-shortcuts';
import { useCueSearch } from './use-cue-search';
import type { ReplaceCueRequest, ReplaceFeedback } from './cue-replacement';
import { CueSearchBar } from './CueSearchBar';
import { CueRow } from './CueRow';
import { useCueWindow } from './use-cue-window';
import { CueTableHeading } from './CueTableHeading';
import { clampCueColumnWidth, cueColumns, cueRowNumberWidth, cueTableMinimumWidth, defaultCueColumnWidths } from './cue-column-widths';

interface Props {
  cues: Cue[];
  styles: ProjectStyle[];
  selectedId: string | null;
  currentTime: number;
  selectedIds: readonly string[];
  onSelect: (cue: Cue, modifiers?: SelectionModifiers) => void;
  onContextSelect: (cue: Cue) => void;
  onAction: (action: CueMenuAction, cue: Cue) => void;
  editable: boolean;
  hasVideo: boolean;
  shortcutOverrides: ShortcutOverrides;
  searchEnabled: boolean;
  searchEpoch: number;
  onReplace: (request: ReplaceCueRequest, signal: AbortSignal) => Promise<ReplaceFeedback>;
  timeShiftEnabled: boolean;
  onTimeShift: () => void;
  workspace: RefObject<HTMLElement | null>;
  qc?: { open: boolean; label: string; panel: ReactNode; onToggle: () => void; onClose: () => void };
  glossary?: { open: boolean; panel: ReactNode; onToggle: () => void; onClose: () => void };
  revealCueId?: { id: string; request: number } | null;
}

export function CueTable({ cues, styles, selectedId, currentTime, selectedIds, onSelect, onContextSelect, onAction,
  editable, hasVideo, shortcutOverrides, searchEnabled, searchEpoch, onReplace, timeShiftEnabled, onTimeShift, workspace,
  qc, glossary, revealCueId }: Props) {
  useLocale();
  const [menu, setMenu] = useState<{ x: number; y: number; cueId: string; keyboard: boolean } | null>(null);
  const menuCue = menu ? cues.find(cue => cue.id === menu.cueId) : undefined;
  useEffect(() => { if (!searchEnabled || (menu && !menuCue)) setMenu(null); }, [searchEnabled, menuCue, menu]);
  const closeMenu = () => { setMenu(null); workspace.current?.focus({ preventScroll: true }); };
  const rows = useMemo(() => orderCues(cues), [cues]);
  const [widths, setWidths] = useState(defaultCueColumnWidths);
  const [headingMinimumWidth, setHeadingMinimumWidth] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const rowWindow = useCueWindow(rows, scroll, JSON.stringify(widths));
  const reveal = rowWindow.reveal;
  useEffect(() => { if (revealCueId) reveal(revealCueId.id); }, [revealCueId, qc?.open]);
  const search = useCueSearch({ cues, selectedId, epoch: searchEpoch, enabled: searchEnabled, editable, workspace, onSelect, onReveal: reveal, onReplace,
    onShow() { if (pane.current && !pane.current.getClientRects().length) { qc?.onClose(); glossary?.onClose(); } } });
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
  const actions = <div className="cue-list-actions">
    <button type="button" data-time-shift aria-haspopup="dialog" disabled={!timeShiftEnabled} onClick={event => {
      event.currentTarget.focus({ preventScroll: true }); onTimeShift();
    }}>{t('workspaceUi.timeShift')}</button>
    <button data-cue-search aria-label={t('workspaceUi.findSubtitles')} aria-expanded={search.open} aria-pressed={search.open}
      disabled={!searchEnabled} onClick={search.toggle}>{t('workspaceUi.find')}</button>
    {qc && <button data-cue-qc aria-label={t('workspaceUi.subtitleQualityCheck')} aria-expanded={qc.open} aria-pressed={qc.open}
      disabled={!searchEnabled} onClick={qc.onToggle}>{qc.label}</button>}
    {glossary && <button data-glossary aria-label={t('workspaceUi.glossary')} aria-expanded={glossary.open} aria-pressed={glossary.open}
      disabled={!searchEnabled} onClick={glossary.onToggle}>{t('workspaceUi.glossary')}</button>}
  </div>;
  const table = <table style={{ minWidth: Math.max(cueTableMinimumWidth(widths), headingMinimumWidth) }} aria-rowcount={rows.length + 1}
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
      <thead className="sr-only"><tr><th scope="col">{t("workspaceUi.line")}</th>{cueColumns.map(column => <th key={column.id} scope="col"
        className={column.id === 'cps' ? 'cps-cell' : undefined} aria-label={column.id === 'cps' ? t("workspaceUi.cpsCharactersPerSecond") : undefined}>
        {formatMessage(column.label)}
      </th>)}<th scope="col">{t("workspaceUi.subtitleText")}</th></tr></thead>
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
            currentMatch={cue.id === search.currentId ? search.currentRange : undefined}
            ranges={highlights.get(cue.id)} styleName={names.get(cue.style_id)} />
        </Fragment>;
      })}{rowWindow.indices.length > 0 && rowWindow.indices.at(-1)! < rows.length - 1 &&
        <tr aria-hidden="true" className="cue-spacer"><td colSpan={6} style={{ height: rowWindow.offsets[rows.length] - rowWindow.offsets[rowWindow.indices.at(-1)! + 1] }} /></tr>}
      </tbody>
    </table>;
  return <section className="cue-list" data-qc-open={qc?.open || glossary?.open || undefined}>
    <CueTableHeading count={cues.length} widths={widths} scroll={scroll} actions={actions} onMinimumWidth={setHeadingMinimumWidth}
      onResize={(column, width) => setWidths(previous => ({ ...previous, [column.id]: clampCueColumnWidth(column, width) }))} />
    <div className="cue-list-body"><div className="cue-table-pane" ref={pane}>
    {search.open && <CueSearchBar search={search} enabled={searchEnabled} editable={editable} />}
    <div className="table-scroll" ref={scroll} data-windowed={rowWindow.enabled || undefined}>{table}{!cues.length && <p className="empty">{t("workspaceUi.noSubtitlesYetChooseStartAndEndTimes")}</p>}</div>
    </div>{qc?.open && qc.panel}{glossary?.open && glossary.panel}</div>
    {menu && menuCue && searchEnabled && <CueContextMenu x={menu.x} y={menu.y} keyboard={menu.keyboard} editable={editable}
      canMerge={selectedSet.size > 1 && selectedSet.has(menuCue.id)} hasVideo={hasVideo} overrides={shortcutOverrides}
      onClose={closeMenu} onAction={action => onAction(action, menuCue)} />}
  </section>;
}
