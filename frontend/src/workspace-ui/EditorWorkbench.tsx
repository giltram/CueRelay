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
import { isEditingShortcut, timingShortcut, type ShortcutOverrides } from './timing-shortcuts';
import { commitTiming } from './commit-timing';
import { playheadBoundary } from './playhead-boundary';
import { deleteCue } from './delete-cue';
import { initializeDocument } from './cue-defaults';
import { AudioTimeline } from './audio-timeline/AudioTimeline';
import type { AudioDisplayMode } from '../media/audio/analysis-types';
import { useAudioAudition } from '../media/audio/use-audio-audition';
import { useAssPreview } from '../ass-preview/use-ass-preview';
import { previewDocument } from './preview-document';
import { orderCues } from '../subtitle-model/cue-order';

export interface WorkbenchHandle {
  hasContent: () => boolean;
  exportDraft: () => Promise<void>;
}
interface Props {
  ref?: Ref<WorkbenchHandle>;
  header?: ReactNode;
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

export function EditorWorkbench({ ref, header, title, shortcutsPaused = false, shortcutOverrides = {}, audioMode = 'spectrum', mouseSetsCueBoundary = true, project, initialMedia, readOnly = false, visible = true, onSave, onSplit, styleRequest, styleOrganizationId, canManageTemplates, onReload }: Props) {
  const [document, setDocument] = useState<AssDocument | null>(project?.document ?? null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [startText, setStartText] = useState('0:00:00.00');
  const [endText, setEndText] = useState('0:00:02.00');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const audioAudition = useAudioAudition(mediaFile, video, visible);
  const cancelAudition = audioAudition.stop;
  const [error, setError] = useState('');
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
  const selected = document?.cues.find(cue => cue.id === selectedId);
  const cueRows = useMemo(() => orderCues(document?.cues ?? []), [document?.cues]);
  const preview = useMemo(() => previewDocument(document, selectedId, startText, endText), [document, selectedId, startText, endText]);
  const subtitles = useAssPreview(video, mediaFile, preview.document, exportAss, visible);
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
      setDocument(initial); selectCue(initial.cues[0]);
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
    try { void Promise.resolve(action()).catch(reason => setError(String(reason.message))); }
    catch (reason) { setError((reason as Error).message); }
  }

  function selectCue(cue: Cue) {
    setSelectedId(cue.id); setStartText(formatTime(cue.start_ms)); setEndText(formatTime(cue.end_ms)); cancelAudition();
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

  function changeTimeDraft(which: 'start' | 'end', value: string) {
    if (which === 'start') setStartText(value); else setEndText(value);
    cancelAudition(); setHasEdits(true);
  }

  function updateCue(patch: Partial<Cue>) {
    if (!canEdit) throw new Error('项目只读或尚未验证本地片源。');
    if (!document || !selected) throw new Error('请先选择一条字幕行');
    setDocument({ ...document, cues: document.cues.map(cue => cue.id === selected.id ? { ...cue, ...patch } : cue) });
    setHasEdits(true);
  }

  function commitAndAdvance() {
    if (!canEdit) throw new Error('项目只读或尚未验证本地片源。');
    if (!document) throw new Error('ASS 服务尚未就绪');
    const result = commitTiming(document, selectedId, parseTime(startText), parseTime(endText), () => `new-${crypto.randomUUID()}`);
    setDocument(result.document);
    setHasEdits(true);
    selectCue(result.selected);
  }

  function setPlayheadBoundary(point: 'start' | 'end') {
    if (!selected) throw new Error('请先选择一条字幕行');
    if (!video || !duration) throw new Error('请先加载可播放的视频');
    const updated = playheadBoundary(selected, point, video.currentTime);
    updateCue(updated);
    changeTimeDraft(point, formatTime(point === 'start' ? updated.start_ms : updated.end_ms));
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
    splitting.current = true; setBusy(true);
    try {
      let result: SplitResult;
      if (project) {
        if (!onSplit) throw new Error('项目拆分保存尚未就绪。');
        const persisted = await onSplit(request, savedRevision);
        result = persisted;
        setSavedRevision(persisted.project.revision); setSavedDocument(persisted.document);
      } else result = await splitAss(request);
      setDocument(result.document); setHasEdits(true);
      const first = result.document.cues.find(cue => cue.id === result.first_id)!;
      selectCue(first);
      restoreTextCursor.current = mode === 'text' ? first.text.length : null;
    } finally { splitting.current = false; setBusy(false); }
  }

  function deleteSelectedCue() {
    if (!canEdit) throw new Error('项目只读或尚未验证本地片源。');
    if (!document || !selected) return;
    const result = deleteCue(document, selected.id);
    setDocument(result.document); setHasEdits(true);
    if (result.selected) selectCue(result.selected);
    else {
      setSelectedId(null); setStartText('0:00:00.00'); setEndText('0:00:00.00'); cancelAudition();
    }
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
    const keydown = (event: KeyboardEvent) => {
      if (busy || splitting.current || pendingImport || stylesOpen || shortcutsPaused || !visible) return;
      if (video && window.document.fullscreenElement?.contains(video) && isFullscreenPlaybackShortcut(event, composing.current)) {
        event.preventDefault();
        if (!event.repeat) run(togglePlayback);
        return;
      }
      const shortcut = timingShortcut(event, composing.current, shortcutOverrides, textEditor.current);
      if (!shortcut || ((shortcut === 'commit' || shortcut === 'delete-row' || isEditingShortcut(shortcut)) && !canEdit)) return;
      event.preventDefault();
      run(() => {
        switch (shortcut) {
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
    window.addEventListener('compositionstart', begin);
    window.addEventListener('compositionend', end);
    window.addEventListener('keydown', keydown);
    return () => {
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
    setBusy(true); setPendingImport(null); setError('');
    try {
      const imported = await importAss(file);
      const initialized = initializeDocument(imported, () => `new-${crypto.randomUUID()}`);
      setHasImportedDocument(true);
      setHasEdits(false); setDocument(initialized);
      if (!imported.cues.length) selectCue(initialized.cues[0]);
      else {
        setSelectedId(null); cancelAudition();
        setStartText('0:00:00.00'); setEndText('0:00:00.00');
      }
    } catch (reason) {
      setError(`拒绝可编辑导入；当前字幕未被替换。${(reason as Error).message}`);
    }
    finally { setBusy(false); }
  }

  async function saveProject() {
    if (!document || !onSave || !canEdit) return;
    setBusy(true); setSaveMessage('');
    try {
      const result = await onSave(document, savedRevision);
      setSavedRevision(result.revision); setSavedDocument(document);
      setSaveMessage('项目已保存。尚未应用的时间输入不包含在本次保存中。');
    } finally { setBusy(false); }
  }

  async function changeStyles(operation: StyleOperation): Promise<StyleResult> {
    if (project || !document || !canEdit || busy) throw new Error('当前无法编辑本地样式。');
    if (operation.type === 'import' || operation.type === 'import_many') throw new Error('组织模板请在项目设置中导入。');
    setBusy(true);
    try {
      const result = await localStyleOperation(document, operation);
      setDocument(result.document); setHasEdits(true);
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
    <main tabIndex={-1} onClick={event => {
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
            selectionId={selectedId} selection={audioSelection} cues={document?.cues || []}
            onBoundaryChange={canEdit && visible && !shortcutsPaused && !busy && !pendingImport && document ? (point, time) => changeTimeDraft(point, formatTime(time)) : undefined}
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
                <TimePointControl label="入点" value={startText}
                  onChange={value => changeTimeDraft('start', value)} />
                <TimePointControl label="出点" value={endText}
                  onChange={value => changeTimeDraft('end', value)} />
              </div>
              <label className="subtitle-input">
                字幕文本
                <textarea ref={textEditor} aria-label="字幕中文文本" rows={2} disabled={!selected} value={selected?.text || ''}
                  placeholder="先选好入点和出点并提交，或选择已有字幕" onChange={event => run(() => updateCue({ text: event.target.value.replace(/\r?\n/g, '\\N') }))} />
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
