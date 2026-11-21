import { formatMessage, t } from '../i18n';
import { useLocale } from "../i18n/react";
import { useMemo, useState } from 'react';
import type { Cue } from '../contracts/subtitles';
import type { QcIssue, QcPhase } from '../subtitle-qc/check-subtitles';
import { orderCues } from '../subtitle-model/cue-order';
import { formatTime } from '../media/playback';
import './subtitle-qc.css';

const severityLabels = { error: "workspaceUi.error", warning: "workspaceUi.warning", info: "workspaceUi.info" } as const;
const severityOrder = { error: 0, warning: 1, info: 2 };
export function qcSummary(issues: readonly QcIssue[]): string {
  return t('workspaceUi.qcSummary', { errors: issues.filter(issue => issue.severity === 'error').length, warnings: issues.filter(issue => issue.severity === 'warning').length, info: issues.filter(issue => issue.severity === 'info').length });
}
interface Props {
  cues: Cue[];
  issues: readonly QcIssue[];
  phase: QcPhase;
  hasResult: boolean;
  checking: boolean;
  stale: boolean;
  formatError: string;
  pendingTiming: boolean;
  disabled: boolean;
  onRun: () => void;
  onSelect: (cue: Cue) => void;
  onClose: () => void;
  onExport: () => void;
  exportFormat?: 'ass' | 'srt';
}

export function SubtitleQcPanel(props: Props) {
  useLocale();
  const { issues, checking, stale, hasResult, disabled } = props;
  const rows = useMemo(() => new Map(orderCues(props.cues).map((cue, index) => [cue.id, { cue, number: index + 1 }])), [props.cues]);
  const sortedIssues = useMemo(() => [...issues].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]), [issues]);
  const [display, setDisplay] = useState({ issues, limit: 100 });
  const limit = display.issues === issues ? display.limit : 100;
  const currentIssues = stale ? [] : sortedIssues.slice(0, limit);
  return <aside className="subtitle-qc-panel" aria-label={t("workspaceUi.subtitleQualityCheck")} data-cue-qc
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) { event.stopPropagation(); return; }
      if (event.key === 'Escape') { event.preventDefault(); props.onClose(); }
      // Buttons keep native Enter/Space; timing shortcuts must not cross this boundary.
      event.stopPropagation();
    }}>
    <div className="qc-heading"><strong>{props.phase === 'export' ? t("workspaceUi.preExportCheck") : t("workspaceUi.subtitleCheck")}</strong>
      <button disabled={disabled || checking} onClick={props.onRun}>{t("workspaceUi.checkAgain")}</button>
      {props.phase === 'export' && <button className="primary"
        disabled={disabled || checking || stale || !hasResult || issues.some(issue => issue.severity === 'error')}
        onClick={props.onExport}>{t(props.exportFormat === 'srt' ? 'srt.continueExport' : 'workspaceUi.continueExportingAss')}</button>}</div>
    <div className="qc-status" role="status" aria-live="polite">
      {checking ? t("workspaceUi.checking") : stale ? t("workspaceUi.subtitlesChangedRunTheCheckAgain") : hasResult ? qcSummary(issues) : t("workspaceUi.notCheckedYet")}
    </div>
    <div className="qc-issues">
      {props.phase === 'export' && props.exportFormat === 'srt' && <p className="qc-note">{t('srt.exportLimitations')}</p>}
      {props.pendingTiming && <p className="qc-note">{t("workspaceUi.thereAreUnappliedTimeInputsChecksAndExport")}</p>}
      {!stale && props.formatError && <p className="qc-note" role="alert">{props.formatError}</p>}
      {currentIssues.map(issue => {
        const affected = issue.cueIds.flatMap(id => rows.get(id) ? [rows.get(id)!] : []);
        const first = affected[0];
        const content = <><span className={`qc-severity qc-${issue.severity}`}>{t(severityLabels[issue.severity])}</span>
          <span className="qc-location">{affected.length ? t("workspaceUi.lineValue", { v0: affected.map(row => row.number).join('、') }) : t("workspaceUi.document")}
            {first && Number.isFinite(first.cue.start_ms) && ` · ${formatTime(first.cue.start_ms)}`}</span>
          <span className="qc-message">{formatMessage(issue.message)}</span></>;
        return first ? <button key={issue.id} className="qc-issue" data-qc-type={issue.type} disabled={disabled}
          onClick={() => props.onSelect(first.cue)}>{content}</button>
          : <div key={issue.id} className="qc-issue" data-qc-type={issue.type}>{content}</div>;
      })}
      {!stale && sortedIssues.length > limit && <button className="qc-more" disabled={disabled}
        onClick={() => setDisplay({ issues, limit: limit + 100 })}>{t("workspaceUi.qcMore", { count: sortedIssues.length - limit })}</button>}
      {hasResult && !stale && !checking && !issues.length && !props.formatError && <p className="qc-note">{t("workspaceUi.noIssuesDetectedByTheCurrentRules")}</p>}
    </div>
  </aside>;
}
