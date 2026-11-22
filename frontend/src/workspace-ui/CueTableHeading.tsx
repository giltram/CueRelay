import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { formatMessage, t } from '../i18n';
import { useLocale } from '../i18n/react';
import { CueColumnResizeHandle } from './CueColumnResizeHandle';
import { cueColumns, cueRowNumberWidth, type CueColumn, type CueColumnWidths } from './cue-column-widths';

/** Persistent heading: shares widths and horizontal scrolling with the native table below. */
export function CueTableHeading({ count, widths, scroll, actions, onResize, onMinimumWidth }: {
  count: number; widths: CueColumnWidths; scroll: RefObject<HTMLDivElement | null>; actions: ReactNode;
  onResize: (column: CueColumn, width: number) => void; onMinimumWidth: (width: number) => void;
}) {
  useLocale();
  const viewport = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLSpanElement>(null);
  const buttons = useRef<HTMLDivElement>(null);
  const position = useRef(0);
  const fixedWidth = cueRowNumberWidth + cueColumns.reduce((sum, column) => sum + widths[column.id], 0);

  useEffect(() => {
    const heading = viewport.current!, body = scroll.current!;
    const label = title.current!, controls = buttons.current!;
    const fromHeading = () => {
      position.current = heading.scrollLeft;
      if (body.clientWidth) body.scrollLeft = position.current;
    };
    const fromBody = () => {
      if (!body.clientWidth) return;
      position.current = body.scrollLeft;
      heading.scrollLeft = position.current;
    };
    const measure = () => {
      onMinimumWidth(Math.ceil(fixedWidth + label.getBoundingClientRect().width + controls.getBoundingClientRect().width + 28));
      // Match the body's reserved vertical scrollbar gutter without adding a second scrollbar row.
      if (body.clientWidth) {
        heading.style.setProperty('--cue-scrollbar-gutter', `${body.offsetWidth - body.clientWidth}px`);
        body.scrollLeft = position.current;
      }
      heading.scrollLeft = position.current;
    };
    const observer = new ResizeObserver(measure);
    [heading, body, label, controls].forEach(element => observer.observe(element));
    heading.addEventListener('scroll', fromHeading, { passive: true });
    body.addEventListener('scroll', fromBody, { passive: true });
    measure();
    return () => {
      observer.disconnect();
      heading.removeEventListener('scroll', fromHeading);
      body.removeEventListener('scroll', fromBody);
    };
  }, [fixedWidth, onMinimumWidth, scroll]);

  return <div className="cue-table-heading">
    <div className="cue-heading-scroll" ref={viewport}>
      <div className="cue-heading-grid" style={{ gridTemplateColumns: `${cueRowNumberWidth}px ${cueColumns.map(column => `${widths[column.id]}px`).join(' ')} minmax(max-content, 1fr)` }}>
        <div className="cue-heading-cell" aria-hidden="true">{t('workspaceUi.line')}</div>
        {cueColumns.map(column => <div className={`cue-heading-cell${column.id === 'cps' ? ' cps-cell' : ''}`} key={column.id}>
          <span aria-hidden="true">{formatMessage(column.label)}</span>
          <CueColumnResizeHandle column={column} width={widths[column.id]} onResize={width => onResize(column, width)} />
        </div>)}
        <div className="cue-heading-cell cue-text-heading">
          <span ref={title}><span aria-hidden="true">{t('workspaceUi.subtitleText')}</span><span className="count" title={t('workspaceUi.sortedByTime')}>{t('workspaceUi.cueCount', { count })}</span></span>
          <div ref={buttons}>{actions}</div>
        </div>
      </div>
    </div>
  </div>;
}
