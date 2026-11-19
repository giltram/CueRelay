import { type MessageValue, describe, MessageError } from '../contracts/messages';
import { formatMessage, msg, t } from '../i18n';
import { useMessageState, useLocale } from '../i18n/react';
import { PageLayout, HeaderNotice } from '../page-ui/PageLayout';
import { diagnosticId } from '../diagnostics/identifier';
import { captureDiagnosticOrigin, reportFailure } from '../diagnostics/errors';
import { diagnostics, noteIgnored, provideWorkspaceStatus, safeError } from '../diagnostics';
import { useCallback, useEffect, useId, useMemo, useRef, useState, useImperativeHandle, type Ref, type ReactNode } from 'react';
import type { ProjectDetail, ProjectSummary, ProjectSaveRequest, ProjectSaveResult } from '../contracts/projects';
import type { AssDocument, Cue, SplitRequest, SplitResult, StyleResult } from '../contracts/subtitles';
import type { StyleOperation } from '../contracts/styles';
import type { JsonRequest } from '../contracts/http';
import { localStyleOperation } from '../project-data/styles-api';
import { ProjectStyleManager } from '../style-ui/ProjectStyleManager';
import '../style-ui/style-management.css';
import { videoStorageKey, type InitialVideo } from '../media/video-file-access';
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
import { deleteLines, type LineEditResult } from './line-edits';
import { lineSelection, selectedLineIds, type SelectionModifiers } from './line-selection';
import { assignLineStyle, selectedLineStyle } from './line-styles';
import { isLineAction } from './line-actions';
import { useLineCommands } from './use-line-commands';
import type { PasteField } from '../project-data/ass-api';
import { PasteOverDialog } from './PasteOverDialog';
import { DEFAULT_CUE_DURATION_MS, initializeDocument } from './cue-defaults';
import { AudioTimeline } from './audio-timeline/AudioTimeline';
import type { AudioDisplayMode } from '../media/audio/analysis-types';
import { useAudioAudition } from '../media/audio/use-audio-audition';
import { useAssPreview } from '../ass-preview/use-ass-preview';
import { previewDocument } from './preview-document';
import { useEditHistory } from './use-edit-history';
import { sameEdit, type EditState } from './edit-history';
import { orderCues } from '../subtitle-model/cue-order';
import { subtitleExportFilename } from './export-filename';
import { useSubtitleQc } from './use-subtitle-qc';
import { GlossaryPanel } from '../glossary-ui/GlossaryPanel';
import { useTermInsertion } from './use-term-insertion';
import { SubtitleQcPanel } from './SubtitleQcPanel';
import { WorkspaceDraftNotice } from './WorkspaceDraftNotice';
import type { DraftContent, WorkspaceDraft } from '../workspace-drafts/model';
import { useWorkspaceDraft, unappliedTiming } from './use-workspace-draft';
import { sameSnapshotValue } from '../subtitle-model/snapshot-equality';

export interface WorkbenchHandle {
  hasContent: () => boolean;
  exportDraft: () => Promise<void>;
  discardDraft: () => Promise<void>;
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
  initialMedia?: InitialVideo;
  mediaOwnerId?: number;
  readOnly?: boolean;
  visible?: boolean;
  onSave?: (input: ProjectSaveRequest) => Promise<ProjectSaveResult>;
  onSplit?: (request: SplitRequest, revision: number) => Promise<SplitResult & { project: ProjectSummary }>;
  styleRequest?: JsonRequest;
  styleOrganizationId?: number;
  canManageTemplates?: boolean;
  onReload?: () => void;
  draftScope?: string;
  onCheckDraftRevision?: () => Promise<number | null>;
}

export function EditorWorkbench({ ref, header, title, diagnosticOwner, shortcutsPaused = false, shortcutOverrides = {}, audioMode = 'spectrum', mouseSetsCueBoundary = true, project, initialMedia, mediaOwnerId, readOnly = false, visible = true, onSave, onSplit, styleRequest, styleOrganizationId, canManageTemplates, onReload, draftScope, onCheckDraftRevision }: Props) {
  useLocale();
  const edits = useEditHistory({
    document: project?.document ?? null, selectedId: null, startText: formatTime(0),
    endText: formatTime(DEFAULT_CUE_DURATION_MS), unselectedEndMs: DEFAULT_CUE_DURATION_MS,
  }, diagnosticOwner);
  const { document, selectedId, startText, endText } = edits.state;
  const selected = document?.cues.find(cue => cue.id === selectedId);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioAudition = useAudioAudition(mediaFile, video, visible);
  const cancelAudition = audioAudition.stop;
  const [error, setErrorState] = useMessageState('');
  const setError = useCallback((message: MessageValue) => {
    if (message) diagnostics.record('workspace', 'user_error', 'error', { error: safeError(message instanceof Error ? message : new Error()) });
    setErrorState(message);
  }, []);
  const [busy, setBusy] = useState(false);
  const [stylesOpen, setStylesOpen] = useState(false);
  const [hasImportedDocument, setHasImportedDocument] = useState(false);
  const [savedRevision, setSavedRevision] = useState(project?.revision ?? 0);
  const [savedDocument, setSavedDocument] = useState(project?.document);
  const localBaseline = useRef<AssDocument>(null);
  const [checkedRevision, setCheckedRevision] = useState<number | null>(null);
  const isProject = Boolean(project);
  const timingDraft = useMemo(() => document && unappliedTiming(edits.state, selected), [document, edits.state, selected]);
  const pendingTiming = timingDraft !== null;
  const documentChanged = document !== (isProject ? savedDocument : localBaseline.current);
  const unsaved = documentChanged || pendingTiming;
  const draftContent = useMemo<DraftContent | null>(() => {
    if (!draftScope || !document || !unsaved) return null;
    return { document, timing: timingDraft, baseRevision: isProject ? savedRevision : null,
      localTimingOnly: !isProject && !documentChanged ? true : undefined };
  }, [draftScope, document, isProject, documentChanged, unsaved, savedRevision, timingDraft]);
  const draft = useWorkspaceDraft(draftScope, draftContent);
  const [mediaVerified, setMediaVerified] = useState(false);
  const [saveMessage, setSaveMessage] = useMessageState('');
  useEffect(() => { setSaveMessage(''); }, [document]);
  const canEdit = !readOnly && (!project || mediaVerified);
  const onVerifiedChange = useCallback((value: boolean) => setMediaVerified(value), []);
  const [hasEdits, setHasEdits] = useState(false);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const composing = useRef(false);
  const workbench = useRef<HTMLElement>(null);
  const textEditor = useRef<HTMLTextAreaElement>(null);
  const textEditorId = useId();
  const styleSelectId = useId();
  const transforming = useRef(false);
  const lineCommands = useLineCommands({ current: edits.current, apply: applyLineEdit, overwrite: overwriteLineFields,
    active: visible && !shortcutsPaused && !pendingImport && !stylesOpen, editable: canEdit,
    pending: transforming, onBusy: setBusy, file: mediaFile, video, duration });
  const pasteOver = lineCommands.over;
  const restoreTextCursor = useRef<number | null>(null);
  useEffect(() => {
    if (busy || restoreTextCursor.current === null || !textEditor.current) return;
    const cursor = Math.min(restoreTextCursor.current, textEditor.current.value.length);
    restoreTextCursor.current = null;
    textEditor.current.focus({ preventScroll: true });
    textEditor.current.setSelectionRange(cursor, cursor);
  }, [busy, selectedId]);
  useEffect(() => { if (!visible) { video?.pause(); cancelAudition(); setStylesOpen(false); lineCommands.close(); } }, [visible, video]);
  useEffect(() => {
    if (!visible || shortcutsPaused || busy || stylesOpen || pasteOver || pendingImport) edits.finish();
  }, [visible, shortcutsPaused, busy, stylesOpen, pasteOver, pendingImport]);
  const selectedIds = selectedLineIds(edits.state);
  const selectedStyleId = document ? selectedLineStyle(document, selectedIds) : '';
  // Inspection/export operates on the retained document, even after session expiry.
  const qcEnabled = visible && !pendingImport && !stylesOpen && !pasteOver;
  const glossaryEnabled = qcEnabled && !shortcutsPaused;
  const qc = useSubtitleQc(document, project?.media.duration_ms ?? (duration > 0 ? duration : null), qcEnabled);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const termInsertion = useTermInsertion({ cueId: selectedId, text: selected?.text ?? '', epoch: edits.epoch,
    editor: textEditor, enabled: canEdit && glossaryEnabled && !busy && Boolean(selected), isComposing: () => composing.current,
    onEdit: text => updateCue({ text }) });
  const [qcReveal, setQcReveal] = useState<{ id: string; request: number } | null>(null);
  function closeQc() { qc.close(); workbench.current?.focus({ preventScroll: true }); }
  function selectQcCue(cue: Cue) {
    selectCueFromTable(cue);
    setQcReveal(previous => ({ id: cue.id, request: (previous?.request ?? 0) + 1 }));
    workbench.current?.focus({ preventScroll: true });
  }
  const textFocusBinding = effectiveBindings('toggle-text-focus', shortcutOverrides)[0];
  const cueRows = useMemo(() => orderCues(document?.cues ?? []), [document?.cues]);
  const preview = useMemo(() => previewDocument(document, selectedId, startText, endText), [document, selectedId, startText, endText]);
  const subtitles = useAssPreview(video, mediaFile, preview.document, exportAss, visible);
  const statusReader = useRef<() => import('../diagnostics/schema').WorkspaceStatus>(() => { throw new Error('not_ready'); });
  statusReader.current = () => ({
    projectId: project?.id ?? null, visible,
    unsaved,
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
      if (!active || edits.current().document) return;
      const initial = initializeDocument(value, () => `new-${crypto.randomUUID()}`);
      localBaseline.current = initial;
      edits.baseline(withSelection({ ...edits.current(), document: initial }, initial.cues[0]));
    })
      .catch(reason => { if (active && !edits.current().document) setError(reason instanceof MessageError ? reason : msg("workspaceUi.cannotConnectToTheAssServiceStartDjango")); });
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
    const failed = (reason: unknown) => { reportFailure('workspace', action.name || 'action', reason, origin, operationId); setErrorState(reason as Error); };
    try { void Promise.resolve(action()).catch(failed); }
    catch (reason) { failed(reason); }
  }

  function draftAction(action: () => Promise<void>) {
    if (transforming.current || busy) return;
    transforming.current = true; setBusy(true);
    run(async () => {
      try { await action(); }
      finally { transforming.current = false; setBusy(false); }
    });
  }

  function restoreDraft(record: WorkspaceDraft) {
    if (draftContent || readOnly) return;
    draftAction(async () => {
      if (project) {
        await accessDraft(record, 'read');
        const latest = await onCheckDraftRevision?.();
        if (typeof latest !== 'number') return;
        setCheckedRevision(latest);
        if (latest !== savedRevision || latest !== record.baseRevision) return;
      }
      const candidate = await accessDraft(record, 'restore');
      const { document, timing } = candidate;
      const restored = savedDocument && sameSnapshotValue(savedDocument, document) ? savedDocument : document;
      const cue = timing?.cueId === null ? undefined
        : restored.cues.find(cue => cue.id === timing?.cueId) ?? restored.cues[0];
      const state = withSelection({ ...edits.current(), document: restored }, cue);
      if (timing) {
        if (timing.cueId === null) {
          // Older drafts omit the baseline. Infer it from the snapshot and
          // preserve a recorded edit if its values happen to match that guess.
          let legacyEndMs = restored === savedDocument ? DEFAULT_CUE_DURATION_MS : 0;
          if (timing.startText === state.startText && timing.endText === formatTime(legacyEndMs)) {
            legacyEndMs = legacyEndMs === 0 ? DEFAULT_CUE_DURATION_MS : 0;
          }
          state.unselectedEndMs = timing.unselectedEndMs ?? legacyEndMs;
        }
        state.startText = timing.startText;
        state.endText = timing.endText;
      }
      if (!project) {
        if (candidate.localTimingOnly) localBaseline.current = restored;
        setHasImportedDocument(true);
      }
      edits.baseline(state);
      cancelAudition();
    });
  }

  async function accessDraft(record: WorkspaceDraft, action: 'read' | 'restore' | 'discard') {
    const candidate = await draft.accessCandidate(record, action).catch(() => {
      throw new MessageError(msg('workspaceUi.draftActionFailed'));
    });
    if (!candidate) throw new MessageError(msg('workspaceUi.draftUnavailable'));
    return candidate;
  }

  function withSelection(state: EditState, cue?: Cue): EditState {
    return { ...state, selectedId: cue?.id ?? null, selectedIds: cue ? [cue.id] : [], selectionAnchorId: cue?.id ?? null,
      startText: formatTime(cue?.start_ms ?? 0), endText: formatTime(cue?.end_ms ?? 0), unselectedEndMs: 0 };
  }

  function selectCue(cue: Cue) {
    const current = edits.current();
    // Only changing the active row discards its uncommitted timing draft.
    edits.navigate(current.selectedId === cue.id ? current : withSelection(current, cue)); cancelAudition();
  }

  function locate(cue: Cue) {
    if (!video) throw new MessageError(describe("workspaceUi.selectAVideoFirst", "请先选择视频"));
    selectCue(cue); video.pause(); seekVideo(video, cue.start_ms);
    setCurrentTime(video.currentTime * 1000);
  }

  function selectCueFromTable(cue: Cue, modifiers: SelectionModifiers = {}) {
    if (transforming.current || pasteOver || !visible || shortcutsPaused || busy || pendingImport || stylesOpen) return;
    run(() => {
      const state = edits.current();
      const selection = lineSelection(state, cue.id, orderCues(state.document?.cues ?? []).map(item => item.id), modifiers);
      const active = state.document?.cues.find(item => item.id === selection.selectedId);
      const next = state.selectedId === selection.selectedId ? state : withSelection(state, active);
      edits.navigate({ ...next, ...selection }); cancelAudition();
      if (active && video && duration) {
        video.pause(); seekVideo(video, active.start_ms); setCurrentTime(video.currentTime * 1000);
      }
    });
  }

  function selectCueForContext(cue: Cue) {
    if (transforming.current) return;
    const state = edits.current();
    // Right click must preserve the playhead for video-time commands.
    if (!selectedLineIds(state).includes(cue.id)) selectCue(cue);
    else if (state.selectedId !== cue.id) edits.navigate({ ...withSelection(state, cue), selectedIds: selectedLineIds(state), selectionAnchorId: state.selectionAnchorId });
  }

  function changeTimeDraft(which: 'start' | 'end', value: string, inputKey?: string, nativeHistory = false) {
    edits.edit({ ...edits.current(), [which === 'start' ? 'startText' : 'endText']: value }, inputKey, nativeHistory);
    cancelAudition(); setHasEdits(true);
  }

  function changeAudioBoundary(point: 'start' | 'end', time: number) {
    if (point !== 'end' || !audioAudition.updateEnd(Math.min(time, duration))) cancelAudition();
    setHasEdits(true);
  }

  function updateCue(patch: Partial<Cue>, inputKey?: string, nativeHistory = false) {
    if (!canEdit) throw new MessageError(describe("workspaceUi.theProjectIsReadOnlyOrTheLocal", "项目只读或尚未验证本地片源。"));
    const state = edits.current();
    const cue = state.document?.cues.find(item => item.id === state.selectedId);
    if (!state.document || !cue) throw new MessageError(describe("workspaceUi.selectASubtitleLineFirst", "请先选择一条字幕行"));
    if (Object.entries(patch).every(([key, value]) => cue[key as keyof Cue] === value)) return;
    edits.edit({ ...state, document: { ...state.document, cues: state.document.cues.map(item => item.id === cue.id ? { ...item, ...patch } : item) } }, inputKey, nativeHistory);
    setHasEdits(true);
  }

  function updateSelectedStyle(styleId: string) {
    if (!canEdit) throw new MessageError(describe("workspaceUi.theProjectIsReadOnlyOrTheLocal", "项目只读或尚未验证本地片源。"));
    const state = edits.current();
    const ids = selectedLineIds(state);
    if (!state.document || !ids.length) throw new MessageError(describe("workspaceUi.selectASubtitleLineFirst", "请先选择一条字幕行"));
    const document = assignLineStyle(state.document, ids, styleId);
    if (document === state.document) return;
    edits.edit({ ...state, document });
    setHasEdits(true);
  }

  function commitAndAdvance() {
    if (!canEdit) throw new MessageError(describe("workspaceUi.theProjectIsReadOnlyOrTheLocal", "项目只读或尚未验证本地片源。"));
    if (!document) throw new MessageError(describe("workspaceUi.theAssServiceIsNotReady", "ASS 服务尚未就绪"));
    diagnostics.record('editor', 'commit_timing', 'start');
    const result = commitTiming(document, selectedId, parseTime(startText), parseTime(endText), () => `new-${crypto.randomUUID()}`);
    edits.edit(withSelection({ ...edits.current(), document: result.document }, result.selected));
    setHasEdits(true); cancelAudition();
    diagnostics.record('editor', 'commit_timing', 'success');
  }

  function setPlayheadBoundary(point: 'start' | 'end') {
    if (!selected) throw new MessageError(describe("workspaceUi.selectASubtitleLineFirst", "请先选择一条字幕行"));
    if (!video || !duration) throw new MessageError(describe("workspaceUi.loadAPlayableVideoFirst", "请先加载可播放的视频"));
    const updated = playheadBoundary(selected, point, video.currentTime);
    if (selected.start_ms === updated.start_ms && selected.end_ms === updated.end_ms
      && (point === 'start' ? startText : endText) === formatTime(point === 'start' ? updated.start_ms : updated.end_ms)) return;
    edits.edit({ ...edits.current(), document: { ...document!, cues: document!.cues.map(cue => cue.id === selected.id ? { ...cue, ...updated } : cue) },
      [point === 'start' ? 'startText' : 'endText']: formatTime(point === 'start' ? updated.start_ms : updated.end_ms) });
    cancelAudition(); setHasEdits(true);
  }

  async function splitSelectedCue(mode: 'playhead' | 'text') {
    if (!canEdit) throw new MessageError(describe("workspaceUi.theProjectIsReadOnlyOrTheLocal", "项目只读或尚未验证本地片源。"));
    if (!document || !selected) throw new MessageError(describe("workspaceUi.selectASubtitleLineFirst", "请先选择一条字幕行"));
    if (transforming.current) return;
    let position: number;
    if (mode === 'playhead') {
      if (!video || !duration) throw new MessageError(describe("workspaceUi.loadAPlayableVideoFirst", "请先加载可播放的视频"));
      position = snapTime(video.currentTime);
    } else {
      const editor = textEditor.current;
      if (!editor || editor !== window.document.activeElement) throw new MessageError(describe("workspaceUi.placeTheCursorInsideTheSubtitleText", "请将光标放在字幕文本内部。"));
      if (editor.selectionStart !== editor.selectionEnd) throw new MessageError(describe("workspaceUi.placeATextCursorWithoutSelectingTextTo", "请选择一个文本光标位置，不能拆分选中文字。"));
      position = editor.selectionStart;
    }
    // Include the displayed timing draft in the frozen snapshot. Failure leaves
    // both the draft and current document untouched; success applies them together.
    const snapshot = { ...document, cues: document.cues.map(cue => cue.id === selected.id
      ? { ...cue, start_ms: parseTime(startText), end_ms: parseTime(endText) } : cue) };
    const request: SplitRequest = { document: snapshot, cue_id: selected.id, mode, position };
    restoreTextCursor.current = mode === 'text' ? position : null;
    diagnostics.record('editor', 'split', 'start', { revision: savedRevision, reason: mode });
    transforming.current = true; setBusy(true);
    try {
      let result: SplitResult;
      if (project) {
        if (!onSplit) throw new MessageError(describe("workspaceUi.projectSplitAndSaveIsNotReady", "项目拆分保存尚未就绪。"));
        draft.flush();
        const persisted = await onSplit(request, savedRevision);
        result = persisted;
        setSavedRevision(persisted.project.revision); setSavedDocument(persisted.document);
        setCheckedRevision(null);
      } else result = await splitAss(request);
      const first = result.document.cues.find(cue => cue.id === result.first_id)!;
      edits.edit(withSelection({ ...edits.current(), document: result.document }, first));
      setHasEdits(true); cancelAudition();
      restoreTextCursor.current = mode === 'text' ? first.text.length : null;
      diagnostics.record('editor', 'split', 'success');
    } finally { transforming.current = false; setBusy(false); }
  }

  function applyLineEdit(before: EditState, result: LineEditResult) {
    const first = result.selected[0];
    edits.edit({ ...withSelection({ ...before, document: result.document }, first), selectedIds: result.selected.map(cue => cue.id) });
    setHasEdits(true); cancelAudition();
  }

  function deleteSelectedCue() {
    if (!canEdit) throw new MessageError(describe("workspaceUi.theProjectIsReadOnlyOrTheLocal", "项目只读或尚未验证本地片源。"));
    const state = edits.current();
    if (!state.document || !selectedLineIds(state).length) return;
    applyLineEdit(state, deleteLines(state.document, selectedLineIds(state), orderCues(state.document.cues)));
  }

  function overwriteLineFields(before: EditState, document: AssDocument, fields: PasteField[]) {
    const active = document.cues.find(cue => cue.id === before.selectedId)!;
    const next = { ...before, document,
      startText: fields.includes('start_ms') ? formatTime(active.start_ms) : before.startText,
      endText: fields.includes('end_ms') ? formatTime(active.end_ms) : before.endText };
    if (sameEdit(before, next)) return;
    edits.edit(next); setHasEdits(true); cancelAudition();
  }

  async function togglePlayback() {
    if (!video || !duration) throw new MessageError(describe("workspaceUi.loadAPlayableVideoFirst", "请先加载可播放的视频"));
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
    if (!video || !duration) throw new MessageError(describe("workspaceUi.loadAPlayableVideoFirst", "请先加载可播放的视频"));
    const range = auditionRange(mode, parseTime(startText), parseTime(endText), duration);
    await audioAudition.start(range, mode === 'selection');
  }

  useEffect(() => {
    const begin = () => { composing.current = true; };
    const end = () => { composing.current = false; };
    const blur = () => edits.finish();
    const keydown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-cue-qc], [data-glossary], [data-workspace-drafts]')) return;
      const candidate = !event.repeat && timingActions.find(action => effectiveBindings(action, shortcutOverrides).includes(bindingFor(event)));
      const blocked = busy || transforming.current || pendingImport || stylesOpen || pasteOver || shortcutsPaused || !visible;
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
      if (candidate && shortcut && !canEdit && (isEditingShortcut(shortcut) || (isLineAction(shortcut) && shortcut !== 'copy-lines') || ['commit', 'delete-row', 'undo', 'redo'].includes(shortcut))) noteIgnored('editor', 'not_editable');
      if (!shortcut || ((shortcut === 'commit' || shortcut === 'delete-row' || shortcut === 'undo' || shortcut === 'redo' || isEditingShortcut(shortcut) || (isLineAction(shortcut) && shortcut !== 'copy-lines')) && !canEdit)) return;
      event.preventDefault();
      run(() => {
        if (isLineAction(shortcut)) return lineCommands.run(shortcut);
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
      setErrorState(msg("workspaceUi.editableImportRejectedCurrentSubtitlesWereKeptValue", { v0: reason as Error }));
    }
    finally { setBusy(false); }
  }

  async function saveProject() {
    if (!document || !savedDocument || !onSave || !canEdit) return;
    diagnostics.record('editor', 'save', 'start', { revision: savedRevision });
    setBusy(true); setSaveMessage('');
    edits.finish();
    draft.flush();
    try {
      const result = await onSave({ document, revision: savedRevision, baseDocument: savedDocument, requiredStyleIds: edits.styleIds() });
      let saved = result.document;
      if (saved !== document) {
        const stillSubmittedDocument = edits.current().document === document;
        const adopted = edits.adoptStyles(saved);
        if (stillSubmittedDocument) saved = adopted.document!;
      }
      setSavedRevision(result.project.revision); setSavedDocument(saved);
      setCheckedRevision(null);
      diagnostics.record('editor', 'save', 'success', { revision: result.project.revision });
      setSaveMessage(msg("workspaceUi.projectSavedUnappliedTimeInputsAreNotIncluded"));
    } finally { setBusy(false); }
  }

  async function changeStyles(operation: StyleOperation): Promise<StyleResult> {
    if (project || !document || !canEdit || busy) throw new MessageError(describe("workspaceUi.localStylesCannotBeEditedRightNow", "当前无法编辑本地样式。"));
    if (operation.type === 'import' || operation.type === 'import_many') throw new MessageError(describe("workspaceUi.importOrganizationTemplatesInProjectSettings", "组织模板请在项目设置中导入。"));
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
    if (!document) throw new MessageError(describe("workspaceUi.theAssServiceIsNotReady", "ASS 服务尚未就绪"));
    await exportSnapshot(document);
  }
  async function exportSnapshot(snapshot: AssDocument) {
    const source = await exportAss(snapshot);
    downloadFile(new Blob([source], { type: 'text/plain;charset=utf-8' }), subtitleExportFilename(project?.name));
  }
  async function downloadDraft() {
    setBusy(true);
    try { await exportDraft(); }
    finally { setBusy(false); }
  }
  async function exportWithQc() {
    const report = await qc.run('export');
    if (!report) return;
    if (report.issues.length || report.formatError) { setGlossaryOpen(false); qc.show(); }
    else await downloadDraft();
  }
  const hasContent = () => hasProtectedContent;
  useImperativeHandle(ref, () => ({
    hasContent, exportDraft,
    async discardDraft() {
      try { await draft.discard(); }
      catch { throw new MessageError(msg('workspaceUi.draftActionFailed')); }
    },
  }));

  return (
    <PageLayout title={title ?? 'CueRelay'} navigation={header} className="editor-workbench" ref={workbench} tabIndex={-1} onBlurCapture={() => edits.finish()} onCompositionStartCapture={() => edits.beginComposition()} onCompositionEndCapture={() => edits.endComposition()} onClick={event => {
      // Blank space and ordinary mouse buttons return to timing shortcuts.
      // Form controls, labels and focusable timing surfaces keep their own focus.
      const target = event.target as Element;
      if (event.detail <= 0 || target.closest('dialog, [data-cue-search], [data-cue-qc], [data-glossary], [data-workspace-drafts]')) return;
      const button = target.closest('button');
      const control = target.closest('input, textarea, select, label, a, summary, video, [tabindex], [contenteditable]');
      if (button ? button.getAttribute('role') !== 'slider' : !control || control === event.currentTarget) {
        event.currentTarget.focus({ preventScroll: true });
      }
    }} actions={
        <div className="file-actions" aria-label={t("workspaceUi.subtitleFileActions")}>
          {project && <>
            <span className="workspace-project-name">{project.name}{readOnly ? project.status === 'archived' ? t("workspaceUi.archivedState") : t("workspaceUi.unavailableState") : ''}</span>
            <button onClick={onReload} disabled={busy}>{t("workspaceUi.reloadProject")}</button>
            {!readOnly && <button className="primary" disabled={busy || !canEdit || document === savedDocument} onClick={() => run(saveProject)}>{t("workspaceUi.saveProject")}</button>}
          </>}
          {!project && <button disabled={busy || !document || Boolean(pendingImport)} onClick={() => { video?.pause(); cancelAudition(); setStylesOpen(true); }}>{t("workspaceUi.manageStyles")}</button>}
          {!project && <label className="file-picker">
            {t("workspaceUi.importAss")}<input aria-label={t("workspaceUi.importBasicAss")} title={t("workspaceUi.importBasicAss")} type="file" accept=".ass" disabled={busy || !document} onChange={event => {
              const file = event.target.files?.[0];
              if (file) {
                if (document?.cues.length && (hasEdits || hasImportedDocument)) setPendingImport(file);
                else void doImport(file);
              }
              event.target.value = '';
            }} />
          </label>}
          <button className="primary" disabled={busy || !document || qc.checking} onClick={() => run(exportWithQc)}>{t("workspaceUi.exportAss")}</button>
        </div>
      }>
      <WorkspaceDraftNotice status={draft.status} candidates={draft.candidates} revision={project ? savedRevision : null}
        revisionChanged={checkedRevision !== null && checkedRevision !== savedRevision}
        canRestore={!draftContent && !readOnly} disabled={busy || shortcutsPaused || Boolean(pendingImport || stylesOpen || pasteOver)}
        onRestore={restoreDraft} onExport={record => draftAction(async () => {
          const candidate = await accessDraft(record, 'read');
          await exportSnapshot(candidate.document);
        })}
        onDiscard={record => draftAction(async () => { await accessDraft(record, 'discard'); })} />
      {busy && <HeaderNotice>{t("workspaceUi.converting")}</HeaderNotice>}
      {project && (readOnly || mediaVerified) && <HeaderNotice>{readOnly
        ? project.status === 'archived' ? t("workspaceUi.archivedProjectsCanOnlyBeViewedAndExported") : t("workspaceUi.projectAccessCouldNotBeVerifiedYouCan")
        : saveMessage || (document === savedDocument ? t("workspaceUi.subtitlesSaved") : t("workspaceUi.thereAreUnsavedSubtitleChangesClickSaveProject"))}</HeaderNotice>}
      {saveMessage && (!project || !mediaVerified || readOnly) && <HeaderNotice>{saveMessage}</HeaderNotice>}
      {pendingImport && (
        <div role="alert" className="confirm">
          <p>{t("workspaceUi.replaceConfirmation", { name: pendingImport.name })}</p>
          <div className="controls">
            <button onClick={() => void doImport(pendingImport)}>{t("workspaceUi.replaceCurrentSubtitles")}</button>
            <button onClick={() => setPendingImport(null)}>{t("workspaceUi.cancel")}</button>
          </div>
        </div>
      )}
      {error && <HeaderNotice className="header-error" role="alert">{error}</HeaderNotice>}
      {outsideDuration && <HeaderNotice className="header-warning">{t("workspaceUi.someSubtitlesExtendBeyondTheVideoCheckThe")}</HeaderNotice>}

      {subtitles.active && <HeaderNotice className="ass-preview-status" data-phase={subtitles.status.phase}>
        {subtitles.status.phase === 'loading' ? t("workspaceUi.loadingAssSubtitles") : subtitles.status.phase === 'error'
          ? subtitles.status.message : formatMessage(preview.warning) || t("workspaceUi.previewUsesTheBundledNotoSansScWhen")}
      </HeaderNotice>}
      <ResizableWorkbench subtitles={
        <CueTable cues={document?.cues || []} styles={document?.styles || []} selectedId={selectedId} currentTime={currentTime}
          selectedIds={selectedIds} onContextSelect={selectCueForContext}
          onAction={action => run(action === 'delete-row' ? deleteSelectedCue : () => lineCommands.run(action))}
          editable={canEdit} hasVideo={Boolean(video && mediaFile && duration)} shortcutOverrides={shortcutOverrides}
          workspace={workbench} searchEnabled={visible && !shortcutsPaused && !busy && !pendingImport && !stylesOpen && !pasteOver}
          revealCueId={qcReveal}
          glossary={project && styleRequest && mediaOwnerId !== undefined ? { open: glossaryOpen,
            onToggle: () => { qc.close(); setGlossaryOpen(value => !value); }, onClose: () => setGlossaryOpen(false),
            panel: <GlossaryPanel key={`${mediaOwnerId}:${project.organization_id}:${project.id}`} request={styleRequest}
              organizationId={project.organization_id} projectId={project.id} enabled={glossaryEnabled && glossaryOpen}
              editable={!readOnly} canInsert={canEdit && glossaryEnabled && !busy && Boolean(selected)} onInsert={termInsertion.insert} /> } : undefined}
          qc={{ open: qc.open, onToggle: () => { if (qc.open) closeQc(); else { setGlossaryOpen(false); qc.toggle(); } }, onClose: qc.close,
            label: qc.checking ? t("workspaceUi.qcChecking") : qc.stale ? t("workspaceUi.qcCheckAgain") : qc.report ? qc.report.formatError ? t('workspaceUi.qcIncomplete', { summary: t('workspaceUi.qcLabel', { count: qc.report.issues.length }) }) : t('workspaceUi.qcLabel', { count: qc.report.issues.length }) : 'QC',
            panel: <SubtitleQcPanel cues={document?.cues ?? []} issues={qc.report?.issues ?? []}
              phase={qc.report?.phase ?? 'editing'} hasResult={Boolean(qc.report)} checking={qc.checking} stale={qc.stale}
              formatError={formatMessage(qc.report?.formatError)} pendingTiming={pendingTiming} disabled={!qcEnabled || busy}
              onRun={() => { void qc.run(); }} onSelect={selectQcCue} onClose={closeQc}
              onExport={() => { if (qc.report && !qc.stale && qc.report.phase === 'export') run(downloadDraft); }} /> }}
          onSelect={selectCueFromTable} />
      } media={
          <LocalVideoPlayer persistenceKey={project && mediaOwnerId !== undefined ? videoStorageKey(mediaOwnerId, project.organization_id, project.id, project.media) : undefined}
            enabled={visible && (!project || mediaOwnerId !== undefined)} expectedMedia={project?.media} initialMedia={initialMedia} onVerifiedChange={onVerifiedChange} onVideo={onVideo} onFile={setMediaFile} onTime={setCurrentTime} onDuration={setDuration} onError={setError}
            currentTime={currentTime} duration={duration} onSeek={seekPlayback}
            playbackControls={<>
              <button className="playback-button" aria-label={t("workspaceUi.playPause")}
                disabled={!duration} onClick={() => run(togglePlayback)}>
                <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M2 3v14l8-7zM12 3h2v14h-2zM16 3h2v14h-2z" />
                </svg>
              </button>
              <div className="time-display">{formatTime(currentTime)}<span> / {formatTime(duration)}</span></div>
            </>}
            subtitleToggle={<button type="button" aria-label={t("workspaceUi.showSubtitles")} aria-pressed={subtitles.enabled}
              onClick={() => subtitles.setEnabled(value => !value)}>{subtitles.enabled ? t("workspaceUi.hideSubtitles") : t("workspaceUi.showSubtitles")}</button>} />
      } editor={<>
          <AudioTimeline visible={visible} file={mediaFile} video={video} duration={duration} currentTime={currentTime} audition={audioAudition.state} getAuditionPosition={audioAudition.getPosition} mode={audioMode} mouseSetsCueBoundary={mouseSetsCueBoundary}
            historyEpoch={edits.epoch} selectionId={selectedId} selection={audioSelection} cues={document?.cues || []}
            onBoundaryChange={canEdit && visible && !shortcutsPaused && !busy && !pendingImport && !stylesOpen && !pasteOver && document ? (point, time) => {
              edits.edit({ ...edits.current(), [point === 'start' ? 'startText' : 'endText']: formatTime(time) });
              changeAudioBoundary(point, time);
            } : undefined}
            onBoundaryGesture={canEdit && visible && !shortcutsPaused && !busy && !pendingImport && !stylesOpen && !pasteOver && document ? () => {
              const gesture = edits.beginGesture();
              return {
                change: (point, time) => { gesture.change(state => ({ ...state, [point === 'start' ? 'startText' : 'endText']: formatTime(time) })); changeAudioBoundary(point, time); },
                end: gesture.end,
              };
            } : undefined}
            onSeek={seekPlayback} />
          <section className="cue-editor" aria-label={t("workspaceUi.subtitleEditing")}>
            <fieldset disabled={busy || !document || !canEdit}>
              <legend className="sr-only">{t("workspaceUi.subtitleEditing")}</legend>
              <div className="cue-fields">
                <TimePointControl key={`start:${edits.epoch}:${selectedId}`} label={t("workspaceUi.start")} value={startText}
                  onChange={(value, native) => changeTimeDraft('start', value, 'start', native)} />
                <TimePointControl key={`end:${edits.epoch}:${selectedId}`} label={t("workspaceUi.end")} value={endText}
                  onChange={(value, native) => changeTimeDraft('end', value, 'end', native)} />
                <div className="cue-style">
                  <label htmlFor={styleSelectId}>{t("workspaceUi.style")}</label>
                  <select id={styleSelectId} aria-label={t("workspaceUi.subtitleStyle")} disabled={!selectedIds.length} value={selectedStyleId}
                    onChange={event => run(() => updateSelectedStyle(event.target.value))}>
                    {!selectedStyleId && <option value="" disabled>{selectedIds.length ? t("workspaceUi.mixedStyles") : t("workspaceUi.selectSubtitles")}</option>}
                    {document?.styles.map(style => <option key={style.id} value={style.id}>{style.name}</option>)}
                  </select>
                </div>
                <button disabled={!selected} onClick={() => run(() => selected && locate(selected))}>{t("workspaceUi.jumpToSelectedLine")}</button>
                <button className="text-button" disabled={!selected} onClick={() => run(deleteSelectedCue)}>{t("workspaceUi.deleteSelectedLine")}</button>
              </div>
              <div className="subtitle-input">
                <label htmlFor={textEditorId}>{t("workspaceUi.subtitleText")}</label>
                <textarea id={textEditorId} key={`text:${edits.epoch}:${selectedId}`} ref={textEditor} aria-label={t("workspaceUi.subtitleTextInput")} title={t("workspaceUi.valueSwitchesBetweenSubtitleInputAndTimingFocus", { v0: textFocusBinding })} rows={2} disabled={!selected} value={selected?.text || ''}
                  onSelect={termInsertion.remember} onBlur={termInsertion.remember}
                  placeholder={t("workspaceUi.chooseStartAndEndTimesAndCommitOr")} onChange={event => run(() => updateCue({ text: event.target.value.replace(/\r?\n/g, '\\N') }, `text:${selectedId}`, ['historyUndo', 'historyRedo'].includes((event.nativeEvent as InputEvent).inputType)))} />
              </div>
            </fieldset>
          </section>
      </>} />

      {pasteOver && <PasteOverDialog busy={busy} error={error} onClose={() => lineCommands.close()} onApply={fields => run(() => lineCommands.applyOver(fields))} />}
      {!project && stylesOpen && document && <ProjectStyleManager document={document} cueRows={cueRows} selectedCueId={selectedId} editable={canEdit}
        persisted={false} request={styleRequest} organizationId={styleOrganizationId} canManageTemplates={canManageTemplates}
        onApply={changeStyles} onClose={() => setStylesOpen(false)} />}
    </PageLayout>
  );
}
