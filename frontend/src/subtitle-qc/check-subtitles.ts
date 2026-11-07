import type { AssDocument, Cue } from '../contracts/subtitles';
import type { AssFormatIssue } from '../contracts/subtitle-qc';
import { orderCues } from '../subtitle-model/cue-order';
import { subtitleCharacterCount, visibleSubtitleText } from '../subtitle-model/text-statistics';
import { validateInterval } from '../subtitle-model/timing';

export type QcPhase = 'editing' | 'export';
export type QcSeverity = 'error' | 'warning' | 'info';
export type QcIssueType = 'invalid-time' | 'duration-short' | 'duration-long' | 'overlap'
  | 'outside-video' | 'empty-text' | 'high-cps' | 'text-long' | 'repeated-text' | 'missing-style' | 'unsupported-ass';
export interface QcIssue {
  id: string;
  type: QcIssueType;
  cueIds: string[];
  severity: QcSeverity;
  message: string;
  measurements: Record<string, number>;
}
export const defaultQcThresholds = {
  minimumDurationMs: 500, maximumDurationMs: 7000, maximumCps: 20, maximumCharacters: 80,
  minimumOverlapMs: 100, minimumOverlapRatio: .25, maximumRepeatGapMs: 1000,
} as const;
export type QcThresholds = { [Key in keyof typeof defaultQcThresholds]: number };
export interface QcOptions {
  phase?: QcPhase;
  videoDurationMs?: number | null;
  thresholds?: Partial<QcThresholds>;
  formatIssues?: readonly AssFormatIssue[];
}

function validInterval(cue: Cue): boolean {
  try { validateInterval(cue.start_ms, cue.end_ms); return true; }
  catch { return false; }
}

/** Advisory, immutable checks of the current applied document; never commits drafts. */
export function checkSubtitles(document: AssDocument, options: QcOptions = {}): QcIssue[] {
  const thresholds = { ...defaultQcThresholds, ...options.thresholds };
  const issues: QcIssue[] = [];
  const ids = new Set<string>();
  function add(type: QcIssueType, cues: readonly Cue[], severity: QcSeverity, message: string, measurements: Record<string, number> = {}) {
    const cueIds = cues.map(cue => cue.id), id = JSON.stringify([type, ...cueIds]);
    if (ids.has(id)) return;
    ids.add(id); issues.push({ id, type, cueIds, severity, message, measurements });
  }
  const styles = new Set(document.styles.map(style => style.id));
  const ordered = orderCues(document.cues);
  const texts = new Map<string, string>();
  const videoDuration = options.videoDurationMs;
  for (const cue of ordered) {
    const valid = validInterval(cue), duration = cue.end_ms - cue.start_ms;
    const visible = visibleSubtitleText(cue.text).replace(/\s+/gu, ' ').trim();
    texts.set(cue.id, visible);
    const characters = subtitleCharacterCount(cue.text);
    if (!valid) add('invalid-time', [cue], 'error', `时间区间无效：入点 ${cue.start_ms}ms，出点 ${cue.end_ms}ms。入点须早于出点，时间须为非负整数、对齐 10ms，且不超过 9:59:59.99。`, { startMs: cue.start_ms, endMs: cue.end_ms });
    else {
      if (duration < thresholds.minimumDurationMs) add('duration-short', [cue], 'warning', `持续 ${duration}ms，短于 ${thresholds.minimumDurationMs}ms。`, { durationMs: duration });
      if (duration > thresholds.maximumDurationMs) add('duration-long', [cue], 'warning', `持续 ${(duration / 1000).toFixed(2)} 秒，长于 ${thresholds.maximumDurationMs / 1000} 秒。`, { durationMs: duration });
      const cps = characters * 1000 / duration;
      if (cps > thresholds.maximumCps) add('high-cps', [cue], 'warning', `阅读速度 ${cps.toFixed(1)} 字/秒，超过 ${thresholds.maximumCps} 字/秒。`, { cps, characters, durationMs: duration });
      if (typeof videoDuration === 'number' && Number.isFinite(videoDuration) && videoDuration > 0 && cue.end_ms > videoDuration) {
        const excess = cue.end_ms - videoDuration;
        add('outside-video', [cue], 'warning', `出点超出视频时长 ${(excess / 1000).toFixed(2)} 秒。`, { videoDurationMs: videoDuration, excessMs: excess });
      }
    }
    if (!visible) add('empty-text', [cue], options.phase === 'export' ? 'warning' : 'info', options.phase === 'export' ? '字幕正文为空，请确认是否仍需导出这条空轴。' : '空轴尚未填写正文，可在翻译阶段补充。');
    if (characters > thresholds.maximumCharacters) add('text-long', [cue], 'warning', `正文共 ${characters} 个计数字符，超过 ${thresholds.maximumCharacters}。`, { characters });
    if (!styles.has(cue.style_id)) add('missing-style', [cue], 'error', '字幕引用了不存在的样式，请重新选择样式。');
  }
  // Adjacent rows only: intentional multi-style overlays are not inferred to be defects.
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1], cue = ordered[index];
    if (previous.style_id !== cue.style_id || !validInterval(previous) || !validInterval(cue)) continue;
    const overlap = Math.min(previous.end_ms, cue.end_ms) - cue.start_ms;
    const shorter = Math.min(previous.end_ms - previous.start_ms, cue.end_ms - cue.start_ms);
    if (overlap > thresholds.minimumOverlapMs && overlap / shorter > thresholds.minimumOverlapRatio) {
      add('overlap', [previous, cue], 'warning', `同样式相邻字幕重叠 ${overlap}ms，占较短行的 ${(overlap / shorter * 100).toFixed(0)}%；请人工确认是否需要叠字。`, { overlapMs: overlap, overlapRatio: overlap / shorter });
    }
    const gap = cue.start_ms - previous.end_ms;
    if (gap >= 0 && gap <= thresholds.maximumRepeatGapMs && texts.get(cue.id) && texts.get(cue.id) === texts.get(previous.id)) {
      add('repeated-text', [previous, cue], 'warning', `相邻字幕正文相同，间隔 ${gap}ms；请确认是否为连续重复。`, { gapMs: gap });
    }
  }
  const byId = new Map(document.cues.map(cue => [cue.id, cue]));
  for (const issue of options.formatIssues ?? []) {
    const cue = issue.cue_id ? byId.get(issue.cue_id) : undefined;
    add(issue.type, cue ? [cue] : [], 'error', issue.message, issue.line ? { sourceLine: issue.line } : {});
  }
  return issues;
}
