import { useEffect, useRef, useState } from 'react';
import type { AssDocument } from '../contracts/subtitles';
import { inspectAss } from '../project-data/ass-api';
import { checkSubtitles, type QcIssue, type QcPhase } from '../subtitle-qc/check-subtitles';

interface Report {
  document: AssDocument;
  videoDurationMs: number | null;
  phase: QcPhase;
  issues: QcIssue[];
  formatError: string;
}

/** Owns only an explicit inspection session; the edit history remains authoritative. */
export function useSubtitleQc(document: AssDocument | null, videoDurationMs: number | null, enabled: boolean) {
  const [open, setOpen] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [checking, setChecking] = useState(false);
  const request = useRef<AbortController | null>(null);
  const current = useRef({ document, videoDurationMs, enabled });
  current.current = { document, videoDurationMs, enabled };
  const stale = Boolean(report && (report.document !== document || report.videoDurationMs !== videoDurationMs));

  useEffect(() => {
    request.current?.abort(); request.current = null; setChecking(false);
  }, [document, videoDurationMs, enabled]);
  useEffect(() => () => request.current?.abort(), []);

  async function run(phase: QcPhase = report?.phase ?? 'editing'): Promise<Report | null> {
    const snapshot = current.current;
    if (!snapshot.document || !snapshot.enabled) return null;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setChecking(true);
    const options = { phase, videoDurationMs: snapshot.videoDurationMs };
    let formatIssues: Awaited<ReturnType<typeof inspectAss>> = [], formatError = '';
    try {
      formatIssues = await inspectAss(snapshot.document, controller.signal);
    } catch (error) {
      if (controller.signal.aborted) return null;
      formatError = `ASS 格式检查未完成：${(error as Error).message}。可重新检查；导出仍由原导出器校验。`;
    }
    if (controller.signal.aborted || current.current.document !== snapshot.document
      || current.current.videoDurationMs !== snapshot.videoDurationMs || !current.current.enabled) return null;
    const issues = checkSubtitles(snapshot.document, { ...options, formatIssues });
    const result = { document: snapshot.document, videoDurationMs: snapshot.videoDurationMs, phase, issues, formatError };
    setReport(result); setChecking(false);
    return result;
  }
  function close() { setOpen(false); }
  function toggle() {
    if (!enabled) return;
    if (open) close();
    else { setOpen(true); if (!checking && (!report || stale || report.phase === 'export')) void run('editing'); }
  }
  return { open, show: () => setOpen(true), close, toggle, run, report, checking, stale };
}
