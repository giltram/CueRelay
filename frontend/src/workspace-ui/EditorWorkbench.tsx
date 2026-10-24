import { useCallback, useEffect, useRef, useState, useImperativeHandle, type Ref, type ReactNode } from 'react';
import type { ProjectDetail, ProjectSummary } from '../contracts/projects';
import type { AssDocument, Cue } from '../contracts/subtitles';
import { LocalVideoPlayer } from '../media/LocalVideoPlayer';
import { auditionRange, formatTime, parseTime, seekVideo, watchPlaybackRange, type AuditionMode, type RangePlayback } from '../media/playback';
import { downloadFile, exportAss, importAss, loadEmptyDocument } from '../project-data/ass-api';
import { CueTable } from './CueTable';
import { TimePointControl } from './TimePointControl';
import { ResizableWorkbench } from './ResizableWorkbench';
import { timingShortcut, type ShortcutOverrides } from './timing-shortcuts';
import { commitTiming } from './commit-timing';
import { deleteCue } from './delete-cue';
import { initializeDocument } from './cue-defaults';
import { AudioTimeline } from './audio-timeline/AudioTimeline';
import type { AudioDisplayMode } from '../media/audio/analysis-types';

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
  project?: ProjectDetail;
  initialMedia?: { file: File; sha256: string };
  readOnly?: boolean;
  visible?: boolean;
  onSave?: (document: AssDocument, revision: number) => Promise<ProjectSummary>;
  onReload?: () => void;
}

export function EditorWorkbench({ ref, header, title, shortcutsPaused = false, shortcutOverrides = {}, audioMode = 'spectrum', project, initialMedia, readOnly = false, visible = true, onSave, onReload }: Props) {
  const [document, setDocument] = useState<AssDocument | null>(project?.document ?? null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [startText, setStartText] = useState('0:00:00.00');
  const [endText, setEndText] = useState('0:00:02.00');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [audition, setAudition] = useState<RangePlayback | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
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
  useEffect(() => { if (!visible) { video?.pause(); setAudition(null); } }, [visible, video]);
  const selected = document?.cues.find(cue => cue.id === selectedId);

  useEffect(() => {
    if (project) return;
    let active = true;
    loadEmptyDocument().then(value => {
      if (!active) return;
      const initial = initializeDocument(value, () => `new-${crypto.randomUUID()}`);
      setDocument(initial); selectCue(initial.cues[0]);
    })
      .catch(() => { if (active) setError('无法连接 ASS 服务，请按 README 启动 Django，然后刷新页面'); });
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
    setSelectedId(cue.id); setStartText(formatTime(cue.start_ms)); setEndText(formatTime(cue.end_ms)); setAudition(null);
  }

  function locate(cue: Cue) {
    if (!video) throw new Error('请先选择视频');
    selectCue(cue); video.pause(); seekVideo(video, cue.start_ms);
  }

  function changeTimeDraft(which: 'start' | 'end', value: string) {
    if (which === 'start') setStartText(value); else setEndText(value);
    setAudition(null); setHasEdits(true);
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

  function deleteSelectedCue() {
    if (!canEdit) throw new Error('项目只读或尚未验证本地片源。');
    if (!document || !selected) return;
    const result = deleteCue(document, selected.id);
    setDocument(result.document); setHasEdits(true);
    if (result.selected) selectCue(result.selected);
    else {
      setSelectedId(null); setStartText('0:00:00.00'); setEndText('0:00:00.00'); setAudition(null);
    }
  }

  async function togglePlayback() {
    if (!video || !duration) throw new Error('请先加载可播放的视频');
    if (video.paused) await video.play(); else video.pause();
  }

  function seekPlayback(time: number) {
    run(() => {
      if (!video || !duration) return;
      setAudition(null);
      seekVideo(video, time);
      setCurrentTime(video.currentTime * 1000);
    });
  }

  async function startAudition(range: RangePlayback | null) {
    if (!video || !duration) throw new Error('请先加载可播放的视频');
    if (range) seekVideo(video, range.start); else video.pause();
    setAudition(range);
    if (!range) return; // The requested range may be entirely outside the video.
    try { await video.play(); }
    catch (reason) {
      setAudition(current => current === range ? null : current);
      throw reason;
    }
  }

  async function playTiming(mode: AuditionMode) {
    const range = auditionRange(mode, parseTime(startText), parseTime(endText), duration);
    await startAudition(range ? { ...range, repeat: false } : null);
  }

  useEffect(() => {
    if (!video || !audition) return;
    return watchPlaybackRange(video, audition, () => setAudition(null), reason => setError(reason.message));
  }, [video, audition]);

  useEffect(() => {
    const begin = () => { composing.current = true; };
    const end = () => { composing.current = false; };
    const keydown = (event: KeyboardEvent) => {
      if (busy || pendingImport || shortcutsPaused || !visible) return;
      const shortcut = timingShortcut(event, composing.current, shortcutOverrides);
      if (!shortcut || ((shortcut === 'commit' || shortcut === 'delete-row') && !canEdit)) return;
      event.preventDefault();
      run(shortcut === 'commit' ? commitAndAdvance : shortcut === 'delete-row' ? deleteSelectedCue : () => playTiming(shortcut));
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
        setSelectedId(null); setAudition(null);
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
      if (event.detail > 0 && button && button.getAttribute('role') !== 'slider') {
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
            currentTime={currentTime} duration={duration} onSeek={seekPlayback} controls={<>
            <button className="playback-button" aria-label="播放 / 暂停"
              disabled={!duration} onClick={() => run(togglePlayback)}>
              <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M2 3v14l8-7zM12 3h2v14h-2zM16 3h2v14h-2z" />
              </svg>
            </button>
            <div className="time-display">{formatTime(currentTime)}<span> / {formatTime(duration)}</span></div>
          </>} />
      } editor={<>
          <AudioTimeline file={mediaFile} video={video} duration={duration} currentTime={currentTime} mode={audioMode}
            selectionId={selectedId} selection={audioSelection} cues={document?.cues || []}
            onBoundaryChange={canEdit && visible && !shortcutsPaused && !busy && !pendingImport && document ? (point, time) => changeTimeDraft(point, formatTime(time)) : undefined}
            onSeek={seekPlayback} />
          <section className="cue-editor" aria-label="字幕编辑">
            <fieldset disabled={busy || !document || !canEdit}>
              <legend className="sr-only">字幕编辑</legend>
              <div className="editor-heading">
                <div className="cue-options">
                  <label>样式
                    <select aria-label="字幕样式" disabled={!selected} value={selected?.style || document?.styles[0] || ''}
                      onChange={event => run(() => updateCue({ style: event.target.value }))}>
                      {document?.styles.map(style => <option key={style}>{style}</option>)}
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
                <textarea aria-label="字幕中文文本" rows={2} disabled={!selected} value={selected?.text || ''}
                  placeholder="先选好入点和出点并提交，或选择已有字幕" onChange={event => run(() => updateCue({ text: event.target.value.replace(/\r?\n/g, '\\N') }))} />
              </label>
            </fieldset>
          </section>
      </>} />
      <CueTable cues={document?.cues || []} selectedId={selectedId} currentTime={currentTime}
        onSelect={selectCue} />
    </main>
  );
}
