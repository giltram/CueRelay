import { diagnosticId } from '../diagnostics/identifier';
import { captureDiagnosticOrigin, reportFailure } from '../diagnostics/errors';
import { diagnostics, noteIgnored, provideWorkspaceStatus, safeError } from '../diagnostics';
import { useCallback, useEffect, useMemo, useRef, useState, useImperativeHandle, type Ref, type ReactNode } from 'react';
import type { ProjectDetail, ProjectSummary } from '../contracts/projects';
import type { AssDocument, Cue, SplitRequest, SplitResult, StyleResult } from '../contracts/subtitles';
import type { StyleOperation } from '../contracts/styles';
import type { JsonRequest } from '../contracts/http';
import { localStyleOperation } from '../project-data/styles-api';
import { ProjectStyleManager } from '../style-ui/ProjectStyleManager';
import '../style-ui/style-management.css';
import { LocalVideoPlayer } from '../media/LocalVideoPlayer';
import { auditionRange, formatTime, isFullscreenPlaybackShortcut, parseTime, seekVideo, snapTime, type AuditionMode } from '../media/playback';
import { downloadFile, exportAss, importAss, loadEmptyDocument, splitAss } from '../project-data/ass-api';
import { CueTable } from './CueTable';
import { TimePointControl } from './TimePointControl';
import { ResizableWorkbench } from './ResizableWorkbench';
import { bindingFor, timingActions, effectiveBindings, isEditingShortcut, timingShortcut, type ShortcutOverrides } from './timing-shortcuts';
import { handleSubtitleFocusShortcut } from './subtitle-focus';
import { commitTiming } from './commit-timing';
import { playheadBoundary } from './playhead-boundary';
import { deleteCue } from './delete-cue';
import { initializeDocument } from './cue-defaults';
import { AudioTimeline } from './audio-timeline/AudioTimeline';
import type { AudioDisplayMode } from '../media/audio/analysis-types';
import { useAudioAudition } from '../media/audio/use-audio-audition';
import { useAssPreview } from '../ass-preview/use-ass-preview';
import { previewDocument } from './preview-document';
import { useEditHistory } from './use-edit-history';
import type { EditState } from './edit-history';
import { orderCues } from '../subtitle-model/cue-order';

export interface WorkbenchHandle {
  hasContent: () => boolean;
  exportDraft: () => Promise<void>;
}
interface Props {
  ref?: Ref<WorkbenchHandle>;
  header?: ReactNode;
  diagnosticOwner?: number;
  title?: ReactNode;
  shortcutsPaused?: boolean;
  shortcutOverrides?: ShortcutOverrides;
  audioMode?: AudioDisplayMode;
  mouseSetsCueBoundary?: boolean;
  project?: ProjectDetail;
  initialMedia?: { file: File; sha256: string };
  readOnly?: boolean;
  visible?: boolean;
  onSave?: (document: AssDocument, revision: number) => Promise<ProjectSummary>;
  onSplit?: (request: SplitRequest, revision: number) => Promise<SplitResult & { project: ProjectSummary }>;
  styleRequest?: JsonRequest;
  styleOrganizationId?: number;
  canManageTemplates?: boolean;
  onReload?: () => void;
}

export function EditorWorkbench({ ref, header, title, diagnosticOwner, shortcutsPaused = false, shortcutOverrides = {}, audioMode = 'spectrum', mouseSetsCueBoundary = true, project, initialMedia, readOnly = false, visible = true, onSave, onSplit, styleRequest, styleOrganizationId, canManageTemplates, onReload }: Props) {
  const edits = useEditHistory({ document: project?.document ?? null, selectedId: null, startText: '0:00:00.00', endText: '0:00:02.00' }, diagnosticOwner);
  const { document, selectedId, startText, endText } = edits.state;
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioAudition = useAudioAudition(mediaFile, video, visible);
  const cancelAudition = audioAudition.stop;
  const [error, setErrorState] = useState('');
  const setError = useCallback((message: string) => {
    if (message) diagnostics.record('workspace', 'user_error', 'error', { error: safeError(new Error(message)) });
    setErrorState(message);
  }, []);
  const [busy, setBusy] = useState(false);
  const [stylesOpen, setStylesOpen] = useState(false);
  const [hasImportedDocument, setHasImportedDocument] = useState(false);
  const [savedRevision, setSavedRevision] = useState(project?.revision ?? 0);
  const [savedDocument, setSavedDocument] = useState(project?.document);
  const [mediaVerified, setMediaVerified] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  useEffect(() => { setSaveMessage(''); }, [document]);
  const canEdit = !readOnly && (!project || mediaVerified);
  const onVerifiedChange = useCallback((value: boolean) => setMediaVerified(value), []);
  const [hasEdits, setHasEdits] = useState(false);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const composing = useRef(false);
  const workbench = useRef<HTMLElement>(null);
  const textEditor = useRef<HTMLTextAreaElement>(null);
  const splitting = useRef(false);
  const restoreTextCursor = useRef<number | null>(null);
  useEffect(() => {
    if (busy || restoreTextCursor.current === null || !textEditor.current) return;
    const cursor = Math.min(restoreTextCursor.current, textEditor.current.value.length);
    restoreTextCursor.current = null;
    textEditor.current.focus({ preventScroll: true });
    textEditor.current.setSelectionRange(cursor, cursor);
  }, [busy, selectedId]);
  useEffect(() => { if (!visible) { video?.pause(); cancelAudition(); setStylesOpen(false); } }, [visible, video]);
  useEffect(() => {
    if (!visible || shortcutsPaused || busy || stylesOpen || pendingImport) edits.finish();
  }, [visible, shortcutsPaused, busy, stylesOpen, pendingImport]);
  const selected = document?.cues.find(cue => cue.id === selectedId);
  const textFocusBinding = effectiveBindings('toggle-text-focus', shortcutOverrides)[0];
  const cueRows = useMemo(() => orderCues(document?.cues ?? []), [document?.cues]);
  const preview = useMemo(() => previewDocument(document, selectedId, startText, endText), [document, selectedId, startText, endText]);
  const subtitles = useAssPreview(video, mediaFile, preview.document, exportAss, visible);
  const statusReader = useRef<() => import('../diagnostics/schema').WorkspaceStatus>(() => { throw new Error('not_ready'); });
  statusReader.current = () => ({
    projectId: project?.id ?? null, visible,
    unsaved: project ? document !== savedDocument || Boolean(selected && (startText !== formatTime(selected.start_ms) || endText !== formatTime(selected.end_ms))) : hasEdits || hasImportedDocument,
    revision: project ? savedRevision : null, editable: canEdit,
    video: { loaded: Boolean(mediaFile), verified: mediaVerified, readyState: video?.readyState ?? null, networkState: video?.networkState ?? null,
      duration: video && Number.isFinite(video.duration) ? video.duration : null, width: video?.videoWidth || null, height: video?.videoHeight || null, errorCode: video?.error?.code ?? null },
    audition: audioAudition.state.phase, preview: subtitles.active ? subtitles.status.phase : 'inactive',
  });
  useEffect(() => diagnosticOwner === undefined ? undefined : provideWorkspaceStatus(diagnosticOwner, () => statusReader.current(), project?.organization_id ?? styleOrganizationId), [diagnosticOwner, project?.organization_id, styleOrganizationId]);
  useEffect(() => {
    const changed = () => {
      if (video && window.document.fullscreenElement?.contains(video)) cancelAudition();
    };
    changed();
    window.document.addEventListener('fullscreenchange', changed);
    return () => window.document.removeEventListener('fullscreenchange', changed);
  }, [video, cancelAudition]);

  useEffect(() => {
    if (project) return;
    let active = true;
    loadEmptyDocument().then(value => {
      if (!active) return;
      const initial = initializeDocument(value, () => `new-${crypto.randomUUID()}`);
      edits.baseline(withSelection({ ...edits.current(), document: initial }, initial.cues[0]));
    })
      .catch(reason => { if (active) setError(reason.message?.includes('v2') ? reason.message : '无法连接 ASS 服务，请按 README 启动 Django，然后刷新页面'); });
    return () => { active = false; };
  }, []);

  const hasProtectedContent = Boolean(busy || pendingImport || mediaFile || project || hasImportedDocument || hasEdits);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (hasProtectedContent) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [hasProtectedContent]);

  function run(action: () => void | Promise<void>) {
    setError('');
    const origin = captureDiagnosticOrigin(), operationId = diagnosticId();
    const failed = (reason: unknown) => { reportFailure('workspace', action.name || 'action', reason, origin, operationId); setErrorState((reason as Error).message); };
    try { void Promise.resolve(action()).catch(failed); }
    catch (reason) { failed(reason); }
  }

  function withSelection(state: EditState, cue?: Cue): EditState {
    return { ...state, selectedId: cue?.id ?? null, startText: formatTime(cue?.start_ms ?? 0), endText: formatTime(cue?.end_ms ?? 0) };
  }

  function selectCue(cue: Cue) {
    edits.navigate(withSelection(edits.current(), cue)); cancelAudition();
  }

  function locate(cue: Cue) {
    if (!video) throw new Error('请先选择视频');
    selectCue(cue); video.pause(); seekVideo(video, cue.start_ms);
    setCurrentTime(video.currentTime * 1000);
  }

  function selectCueFromTable(cue: Cue) {
    if (splitting.current) return;
    run(() => {
      if (video && duration) locate(cue);
      else selectCue(cue);
    });
  }

  function changeTimeDraft(which: 'start' | 'end', value: string, inputKey?: string, nativeHistory = false) {
    edits.edit({ ...edits.current(), [which === 'start' ? 'startText' : 'endText']: value }, inputKey, nativeHistory);
    cancelAudition(); setHasEdits(true);
  }

  function updateCue(patch: Partial<Cue>, inputKey?: string, nativeHistory = false) {
    if (!canEdit) throw new Error('项目只读或尚未验证本地片源。');
    const state = edits.current();
    const cue = state.document?.cues.find(item => item.id === state.selectedId);
    if (!state.document || !cue) throw new Error('请先选择一条字幕行');
    if (Object.entries(patch).every(([key, value]) => cue[key as keyof Cue] === value)) return;
    edits.edit({ ...state, document: { ...state.document, cues: state.document.cues.map(item => item.id === cue.id ? { ...item, ...patch } : item) } }, inputKey, nativeHistory);
    setHasEdits(true);
  }

  function commitAndAdvance() {
    if (!canEdit) throw new Error('项目只读或尚未验证本地片源。');
    if (!document) throw new Error('ASS 服务尚未就绪');
    diagnostics.record('editor', 'commit_timing', 'start');
    const result = commitTiming(document, selectedId, parseTime(startText), parseTime(endText), () => `new-${crypto.randomUUID()}`);
    edits.edit(withSelection({ ...edits.current(), document: result.document }, result.selected));
    setHasEdits(true); cancelAudition();
    diagnostics.record('editor', 'commit_timing', 'success');
  }

  function setPlayheadBoundary(point: 'start' | 'end') {
    if (!selected) throw new Error('请先选择一条字幕行');
    if (!video || !duration) throw new Error('请先加载可播放的视频');
    const updated = playheadBoundary(selected, point, video.currentTime);
    if (selected.start_ms === updated.start_ms && selected.end_ms === updated.end_ms
      && (point === 'start' ? startText : endText) === formatTime(point === 'start' ? updated.start_ms : updated.end_ms)) return;
    edits.edit({ ...edits.current(), document: { ...document!, cues: document!.cues.map(cue => cue.id === selected.id ? { ...cue, ...updated } : cue) },
      [point === 'start' ? 'startText' : 'endText']: formatTime(point === 'start' ? updated.start_ms : updated.end_ms) });
    cancelAudition(); setHasEdits(true);
  }

  async function splitSelectedCue(mode: 'playhead' | 'text') {
    if (!canEdit) throw new Error('项目只读或尚未验证本地片源。');
    if (!document || !selected) throw new Error('请先选择一条字幕行');
    if (splitting.current) return;
    let position: number;
    if (mode === 'playhead') {
      if (!video || !duration) throw new Error('请先加载可播放的视频');
      position = snapTime(video.currentTime);
    } else {
      const editor = textEditor.current;
      if (!editor || editor !== window.document.activeElement) throw new Error('请将光标放在字幕文本内部。');
      if (editor.selectionStart !== editor.selectionEnd) throw new Error('请选择一个文本光标位置，不能拆分选中文字。');
      position = editor.selectionStart;
    }
    // Include the displayed timing draft in the frozen snapshot. Failure leaves
    // both the draft and current document untouched; success applies them together.
    const snapshot = { ...document, cues: document.cues.map(cue => cue.id === selected.id
      ? { ...cue, start_ms: parseTime(startText), end_ms: parseTime(endText) } : cue) };
    const request: SplitRequest = { document: snapshot, cue_id: selected.id, mode, position };
    restoreTextCursor.current = mode === 'text' ? position : null;
    diagnostics.record('editor', 'split', 'start', { revision: savedRevision, reason: mode });
    splitting.current = true; setBusy(true);
    try {
      let result: SplitResult;
      if (project) {
        if (!onSplit) throw new Error('项目拆分保存尚未就绪。');
        const persisted = await onSplit(request, savedRevision);
        result = persisted;
        setSavedRevision(persisted.project.revision); setSavedDocument(persisted.document);
      } else result = await splitAss(request);
      const first = result.document.cues.find(cue => cue.id === result.first_id)!;
      edits.edit(withSelection({ ...edits.current(), document: result.document }, first));
      setHasEdits(true); cancelAudition();
      restoreTextCursor.current = mode === 'text' ? first.text.length : null;
      diagnostics.record('editor', 'split', 'success');
    } finally { splitting.current = false; setBusy(false); }
  }

  function deleteSelectedCue() {
    if (!canEdit) throw new Error('项目只读或尚未验证本地片源。');
    if (!document || !selected) return;
    diagnostics.record('editor', 'delete', 'success', { cueId: selected.id });
    const result = deleteCue(document, selected.id);
    edits.edit(withSelection({ ...edits.current(), document: result.document }, result.selected ?? undefined));
    setHasEdits(true); cancelAudition();
  }

  async function togglePlayback() {
    if (!video || !duration) throw new Error('请先加载可播放的视频');
    cancelAudition();
    if (video.paused) await video.play(); else video.pause();
  }

  function seekPlayback(time: number) {
    run(() => {
      if (!video || !duration) return;
      cancelAudition();
      seekVideo(video, time);
      setCurrentTime(video.currentTime * 1000);
    });
  }

  async function playTiming(mode: AuditionMode) {
    if (!video || !duration) throw new Error('请先加载可播放的视频');
    const range = auditionRange(mode, parseTime(startText), parseTime(endText), duration);
    await audioAudition.start(range);
  }

  useEffect(() => {
    const begin = () => { composing.current = true; };
    const end = () => { composing.current = false; };
    const blur = () => edits.finish();
    const keydown = (event: KeyboardEvent) => {
      const candidate = !event.repeat && timingActions.find(action => effectiveBindings(action, shortcutOverrides).includes(bindingFor(event)));
      const blocked = busy || splitting.current || pendingImport || stylesOpen || shortcutsPaused || !visible;
      if (candidate && blocked) noteIgnored('editor', stylesOpen || shortcutsPaused ? 'modal_or_paused' : !visible ? 'hidden' : 'busy');
      if (blocked) return;
      if (canEdit && selected && !window.document.fullscreenElement
        && handleSubtitleFocusShortcut(event, composing.current, workbench.current, textEditor.current, textFocusBinding)) return;
      if (video && window.document.fullscreenElement?.contains(video) && isFullscreenPlaybackShortcut(event, composing.current)) {
        event.preventDefault();
        if (!event.repeat) run(togglePlayback);
        return;
      }
      const shortcut = timingShortcut(event, composing.current, shortcutOverrides, textEditor.current);
      if (candidate && !shortcut) noteIgnored('editor', composing.current || event.isComposing ? 'ime' : 'focus_or_native_behavior');
      if (candidate && shortcut && !canEdit && (isEditingShortcut(shortcut) || ['commit', 'delete-row', 'undo', 'redo'].includes(shortcut))) noteIgnored('editor', 'not_editable');
      if (!shortcut || ((shortcut === 'commit' || shortcut === 'delete-row' || shortcut === 'undo' || shortcut === 'redo' || isEditingShortcut(shortcut)) && !canEdit)) return;
      event.preventDefault();
      run(() => {
        switch (shortcut) {
          case 'undo': case 'redo': cancelAudition(); edits.travel(shortcut); return;
          case 'commit': return commitAndAdvance();
          case 'delete-row': return deleteSelectedCue();
          case 'set-start-playhead': return setPlayheadBoundary('start');
          case 'set-end-playhead': return setPlayheadBoundary('end');
          case 'split-playhead': return splitSelectedCue('playhead');
          case 'split-text': return splitSelectedCue('text');
          default: return playTiming(shortcut);
        }
      });
    };
    window.addEventListener('blur', blur);
    window.addEventListener('compositionstart', begin);
    window.addEventListener('compositionend', end);
    window.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('blur', blur);
      window.removeEventListener('compositionstart', begin);
      window.removeEventListener('compositionend', end);
      window.removeEventListener('keydown', keydown);
    };
  });

  const onVideo = useCallback((element: HTMLVideoElement | null) => setVideo(element), []);
  const outsideDuration = duration > 0 && document?.cues.some(cue => cue.end_ms > duration);
  let audioSelection: { start: number; end: number } | null = null;
  if (document && (selected || document.cues.length === 0)) {
    try { audioSelection = { start: parseTime(startText), end: parseTime(endText) }; }
    catch { /* A partially typed time has no drawable boundary; the editor retains its draft. */ }
  }

  async function doImport(file: File) {
    const origin = captureDiagnosticOrigin();
    diagnostics.record('editor', 'import', 'start');
    setBusy(true); setPendingImport(null); setError('');
    try {
      const imported = await importAss(file);
      const initialized = initializeDocument(imported, () => `new-${crypto.randomUUID()}`);
      diagnostics.record('editor', 'import', 'success', { count: imported.cues.length }, origin.scope, origin.context);
      setHasImportedDocument(true);
      setHasEdits(false);
      edits.baseline(withSelection({ ...edits.current(), document: initialized }, !imported.cues.length ? initialized.cues[0] : undefined));
      cancelAudition();
    } catch (reason) {
      reportFailure('editor', 'import', reason, origin);
      setErrorState(`拒绝可编辑导入；当前字幕未被替换。${(reason as Error).message}`);
    }
    finally { setBusy(false); }
  }

  async function saveProject() {
    if (!document || !onSave || !canEdit) return;
    diagnostics.record('editor', 'save', 'start', { revision: savedRevision });
    setBusy(true); setSaveMessage('');
    try {
      const result = await onSave(document, savedRevision);
      setSavedRevision(result.revision); setSavedDocument(document);
      diagnostics.record('editor', 'save', 'success', { revision: result.revision });
      setSaveMessage('项目已保存。尚未应用的时间输入不包含在本次保存中。');
    } finally { setBusy(false); }
  }

  async function changeStyles(operation: StyleOperation): Promise<StyleResult> {
    if (project || !document || !canEdit || busy) throw new Error('当前无法编辑本地样式。');
    if (operation.type === 'import' || operation.type === 'import_many') throw new Error('组织模板请在项目设置中导入。');
    setBusy(true);
    try {
      const result = await localStyleOperation(document, operation);
      // Pure server transformations may return a fresh but unchanged snapshot.
      if (JSON.stringify(result.document) !== JSON.stringify(document)) {
        edits.edit({ ...edits.current(), document: result.document }); setHasEdits(true);
      }
      return result;
    } finally { setBusy(false); }
  }

  async function exportDraft() {
    if (!document) throw new Error('ASS 服务尚未就绪');
    downloadFile(new Blob([await exportAss(document)], { type: 'text/plain;charset=utf-8' }), 'cuerelay.ass');
  }
  const hasContent = () => hasProtectedContent;
  useImperativeHandle(ref, () => ({ hasContent, exportDraft }));

  return (
    <main className="editor-workbench" ref={workbench} tabIndex={-1} onBlurCapture={() => edits.finish()} onCompositionStartCapture={() => edits.beginComposition()} onCompositionEndCapture={() => edits.endComposition()} onClick={event => {
      // Mouse activation returns to timing shortcuts; keyboard activation keeps
      // native button focus. Boundary sliders retain focus for arrow-key edits.
      const button = (event.target as Element).closest('button');
      if (event.detail > 0 && button && !button.closest('dialog') && button.getAttribute('role') !== 'slider') {
        event.currentTarget.focus({ preventScroll: true });
      }
    }}>
      <header className="app-header">
        <h1>{title ?? 'CueRelay'}</h1>
        <div className="file-actions" aria-label="字幕文件操作">
          {project && <>
            <span className="workspace-project-name">{project.name}{readOnly ? project.status === 'archived' ? ' · 已归档，只读' : ' · 暂不可编辑' : ''}</span>
            <button onClick={onReload} disabled={busy}>重新加载项目</button>
            {!readOnly && <button className="primary" disabled={busy || !canEdit || document === savedDocument} onClick={() => run(saveProject)}>保存项目</button>}
          </>}
          {busy && <span role="status">正在转换…</span>}
          {!project && <button disabled={busy || !document || Boolean(pendingImport)} onClick={() => { video?.pause(); cancelAudition(); setStylesOpen(true); }}>管理样式</button>}
          {!project && <label className="file-picker">
            导入 ASS
            <input aria-label="导入基础 ASS" type="file" accept=".ass" disabled={busy || !document} onChange={event => {
              const file = event.target.files?.[0];
              if (file) {
                if (document?.cues.length && (hasEdits || hasImportedDocument)) setPendingImport(file);
                else void doImport(file);
              }
              event.target.value = '';
            }} />
          </label>}
          <button className="primary" disabled={busy || !document} onClick={() => run(async () => {
            if (!document) return;
            setBusy(true);
            try { downloadFile(new Blob([await exportAss(document)], { type: 'text/plain;charset=utf-8' }), 'cuerelay.ass'); }
            finally { setBusy(false); }
          })}>导出 ASS</button>
        </div>
        {header}
      </header>

      {project && <p className="project-workspace-status" role="status">{readOnly
        ? project.status === 'archived' ? '已归档项目仅可查看和导出。' : '当前无法验证项目访问权限，仅可查看和导出。请重新登录或检查组织权限。'
        : !mediaVerified ? '请选择与项目基准一致的本地视频；完整校验通过后可编辑和保存。' : document === savedDocument ? '字幕已保存。' : '存在尚未保存的字幕修改，请点击保存项目。'}</p>}
      {saveMessage && <p role="status">{saveMessage}</p>}
      {pendingImport && (
        <div role="alert" className="confirm">
          <p>导入「{pendingImport.name}」将替换当前字幕，请先导出需要的修改。</p>
          <div className="controls">
            <button onClick={() => void doImport(pendingImport)}>替换当前字幕</button>
            <button onClick={() => setPendingImport(null)}>取消</button>
          </div>
        </div>
      )}
      {error && <div className="error" role="alert">{error}</div>}
      {outsideDuration && <div className="warning">部分字幕超出视频时长，请核对片源。字幕时间保持原值。</div>}

      <ResizableWorkbench media={
          <LocalVideoPlayer expectedMedia={project?.media} initialMedia={initialMedia} onVerifiedChange={onVerifiedChange} onVideo={onVideo} onFile={setMediaFile} onTime={setCurrentTime} onDuration={setDuration} onError={setError}
            currentTime={currentTime} duration={duration} onSeek={seekPlayback}
            status={subtitles.active && <div className="ass-preview-status" role="status" data-phase={subtitles.status.phase}>
              {subtitles.status.phase === 'loading' ? '正在加载 ASS 字幕…' : subtitles.status.phase === 'error'
                ? subtitles.status.message : preview.warning || '预览使用内置 Noto Sans SC；指定字体未提供时会替代，可能与最终效果有差异。'}
            </div>}
            controls={<>
            <button className="playback-button" aria-label="播放 / 暂停"
              disabled={!duration} onClick={() => run(togglePlayback)}>
              <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M2 3v14l8-7zM12 3h2v14h-2zM16 3h2v14h-2z" />
              </svg>
            </button>
            <div className="time-display">{formatTime(currentTime)}<span> / {formatTime(duration)}</span></div>
            <button type="button" aria-label="显示字幕" aria-pressed={subtitles.enabled}
              onClick={() => subtitles.setEnabled(value => !value)}>{subtitles.enabled ? '隐藏字幕' : '显示字幕'}</button>
          </>} />
      } editor={<>
          <AudioTimeline file={mediaFile} video={video} duration={duration} currentTime={currentTime} audition={audioAudition.state} getAuditionPosition={audioAudition.getPosition} mode={audioMode} mouseSetsCueBoundary={mouseSetsCueBoundary}
            historyEpoch={edits.epoch} selectionId={selectedId} selection={audioSelection} cues={document?.cues || []}
            onBoundaryChange={canEdit && visible && !shortcutsPaused && !busy && !pendingImport && !stylesOpen && document ? (point, time) => changeTimeDraft(point, formatTime(time)) : undefined}
            onBoundaryGesture={canEdit && visible && !shortcutsPaused && !busy && !pendingImport && !stylesOpen && document ? () => {
              const gesture = edits.beginGesture();
              return {
                change: (point, time) => { gesture.change(state => ({ ...state, [point === 'start' ? 'startText' : 'endText']: formatTime(time) })); cancelAudition(); setHasEdits(true); },
                end: gesture.end,
              };
            } : undefined}
            onSeek={seekPlayback} />
          <section className="cue-editor" aria-label="字幕编辑">
            <fieldset disabled={busy || !document || !canEdit}>
              <legend className="sr-only">字幕编辑</legend>
              <div className="editor-heading">
                <div className="cue-options">
                  <label>样式
                    <select aria-label="字幕样式" disabled={!selected} value={selected?.style_id || document?.styles[0]?.id || ''}
                      onChange={event => run(() => updateCue({ style_id: event.target.value }))}>
                      {document?.styles.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}
                    </select>
                  </label>
                  <button disabled={!selected} onClick={() => run(() => selected && locate(selected))}>定位选中行</button>
                  <button className="text-button" disabled={!selected} onClick={() => run(deleteSelectedCue)}>删除选中行</button>
                </div>
              </div>
              <div className="time-points">
                <TimePointControl key={`start:${edits.epoch}:${selectedId}`} label="入点" value={startText}
                  onChange={(value, native) => changeTimeDraft('start', value, 'start', native)} />
                <TimePointControl key={`end:${edits.epoch}:${selectedId}`} label="出点" value={endText}
                  onChange={(value, native) => changeTimeDraft('end', value, 'end', native)} />
              </div>
              <label className="subtitle-input">
                字幕文本
                <textarea key={`text:${edits.epoch}:${selectedId}`} ref={textEditor} aria-label="字幕中文文本" title={`${textFocusBinding} 切换字幕输入与打轴焦点；Shift+Tab 按原顺序导航`} rows={2} disabled={!selected} value={selected?.text || ''}
                  placeholder="先选好入点和出点并提交，或选择已有字幕" onChange={event => run(() => updateCue({ text: event.target.value.replace(/\r?\n/g, '\\N') }, `text:${selectedId}`, ['historyUndo', 'historyRedo'].includes((event.nativeEvent as InputEvent).inputType)))} />
              </label>
            </fieldset>
          </section>
      </>} />
      <CueTable cues={document?.cues || []} styles={document?.styles || []} selectedId={selectedId} currentTime={currentTime}
        onSelect={selectCueFromTable} />
      {!project && stylesOpen && document && <ProjectStyleManager document={document} cueRows={cueRows} selectedCueId={selectedId} editable={canEdit}
        persisted={false} request={styleRequest} organizationId={styleOrganizationId} canManageTemplates={canManageTemplates}
        onApply={changeStyles} onClose={() => setStylesOpen(false)} />}
    </main>
  );
}
