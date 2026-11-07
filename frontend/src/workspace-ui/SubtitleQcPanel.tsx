import { useMemo, useState } from 'react';
import type { Cue } from '../contracts/subtitles';
import type { QcIssue, QcPhase } from '../subtitle-qc/check-subtitles';
import { orderCues } from '../subtitle-model/cue-order';
import { formatTime } from '../media/playback';
import './subtitle-qc.css';

const severityLabels = { error: '错误', warning: '警告', info: '提示' };
const severityOrder = { error: 0, warning: 1, info: 2 };
export function qcSummary(issues: readonly QcIssue[]): string {
  return (['error', 'warning', 'info'] as const).map(severity =>
    `${severityLabels[severity]} ${issues.filter(issue => issue.severity === severity).length}`).join(' · ');
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
}

export function SubtitleQcPanel(props: Props) {
  const { issues, checking, stale, hasResult, disabled } = props;
  const rows = useMemo(() => new Map(orderCues(props.cues).map((cue, index) => [cue.id, { cue, number: index + 1 }])), [props.cues]);
  const sortedIssues = useMemo(() => [...issues].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]), [issues]);
  const [display, setDisplay] = useState({ issues, limit: 100 });
  const limit = display.issues === issues ? display.limit : 100;
  const currentIssues = stale ? [] : sortedIssues.slice(0, limit);
  return <aside className="subtitle-qc-panel" aria-label="字幕质量检查" data-cue-qc
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) { event.stopPropagation(); return; }
      if (event.key === 'Escape') { event.preventDefault(); props.onClose(); }
      // Buttons keep native Enter/Space; timing shortcuts must not cross this boundary.
      event.stopPropagation();
    }}>
    <div className="qc-heading"><strong>{props.phase === 'export' ? '导出前检查' : '字幕检查'}</strong>
      <button disabled={disabled || checking} onClick={props.onRun}>重新检查</button>
      {props.phase === 'export' && <button className="primary"
        disabled={disabled || checking || stale || !hasResult || issues.some(issue => issue.severity === 'error')}
        onClick={props.onExport}>继续导出 ASS</button>}</div>
    <div className="qc-status" role="status" aria-live="polite">
      {checking ? '正在检查…' : stale ? '字幕已修改，待重新检查。' : hasResult ? qcSummary(issues) : '尚未检查。'}
    </div>
    <div className="qc-issues">
      {props.pendingTiming && <p className="qc-note">存在未提交的时间输入；检查和导出使用字幕行已应用的时间。</p>}
      {!stale && props.formatError && <p className="qc-note" role="alert">{props.formatError}</p>}
      {currentIssues.map(issue => {
        const affected = issue.cueIds.flatMap(id => rows.get(id) ? [rows.get(id)!] : []);
        const first = affected[0];
        const content = <><span className={`qc-severity qc-${issue.severity}`}>{severityLabels[issue.severity]}</span>
          <span className="qc-location">{affected.length ? `第 ${affected.map(row => row.number).join('、')} 行` : '文档'}
            {first && Number.isFinite(first.cue.start_ms) && ` · ${formatTime(first.cue.start_ms)}`}</span>
          <span className="qc-message">{issue.message}</span></>;
        return first ? <button key={issue.id} className="qc-issue" data-qc-type={issue.type} disabled={disabled}
          onClick={() => props.onSelect(first.cue)}>{content}</button>
          : <div key={issue.id} className="qc-issue" data-qc-type={issue.type}>{content}</div>;
      })}
      {!stale && sortedIssues.length > limit && <button className="qc-more" disabled={disabled}
        onClick={() => setDisplay({ issues, limit: limit + 100 })}>显示更多（剩余 {sortedIssues.length - limit} 条）</button>}
      {hasResult && !stale && !checking && !issues.length && !props.formatError && <p className="qc-note">未发现当前规则可识别的问题。</p>}
    </div>
  </aside>;
}
