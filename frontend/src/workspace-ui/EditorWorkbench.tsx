import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssDocument, Cue } from '../contracts/subtitles';
import { LocalVideoPlayer } from '../media/LocalVideoPlayer';
import { auditionRange, formatTime, parseTime, seekVideo, snapTime, validateInterval, watchPlaybackRange, type AuditionMode, type RangePlayback } from '../media/playback';
import { downloadFile, exportAss, importAss, loadEmptyDocument } from '../project-data/ass-api';
import { CueTable } from './CueTable';
import { TimePointControl } from './TimePointControl';
import { ResizableWorkbench } from './ResizableWorkbench';
import { timingShortcut } from './timing-shortcuts';
import { AudioTimeline } from './audio-timeline/AudioTimeline';
import type { AudioDisplayMode } from '../media/audio/analysis-types';

export function EditorWorkbench() {
  const [document, setDocument] = useState<AssDocument | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [audioMode, setAudioMode] = useState<AudioDisplayMode>('spectrum');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [startText, setStartText] = useState('0:00:00.00');
  const [endText, setEndText] = useState('0:00:00.00');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [audition, setAudition] = useState<RangePlayback | null>(null);
  const loop = audition?.repeat ? audition : null;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [hasImportedDocument, setHasImportedDocument] = useState(false);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const composing = useRef(false);
  const selected = document?.cues.find(cue => cue.id === selectedId);

  useEffect(() => {
    let active = true;
    loadEmptyDocument().then(value => { if (active) setDocument(value); })
      .catch(() => { if (active) setError('无法连接 ASS 服务，请按 README 启动 Django，然后刷新页面'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (document && (document.cues.length > 0 || hasImportedDocument)) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [document, hasImportedDocument]);

  function run(action: () => void | Promise<void>) {
    setError('');
    try { void Promise.resolve(action()).catch(reason => setError(String(reason.message))); }
    catch (reason) { setError((reason as Error).message); }
  }

  function selectedTimes(start: number, end: number) {
    validateInterval(start, end);
    return { start, end };
  }

  function selectCue(cue: Cue) {
    setSelectedId(cue.id); setStartText(formatTime(cue.start_ms)); setEndText(formatTime(cue.end_ms)); setAudition(null);
  }

  function locate(cue: Cue) {
    if (!video) throw new Error('请先选择视频');
    selectCue(cue); video.pause(); seekVideo(video, cue.start_ms);
  }

  function capture(which: 'start' | 'end') {
    if (!video || !duration) throw new Error('请先加载可播放的视频');
    const value = formatTime(snapTime(video.currentTime));
    changeTimeDraft(which, value);
  }

  function changeTimeDraft(which: 'start' | 'end', value: string) {
    if (which === 'start') setStartText(value); else setEndText(value);
    setAudition(null);
  }

  function nudge(which: 'start' | 'end', delta: number) {
    const value = parseTime(which === 'start' ? startText : endText) + delta;
    if (value < 0 || value > 35_999_990) throw new Error('微调时间超出范围');
    changeTimeDraft(which, formatTime(value));
  }

  function createCue() {
    if (!document) throw new Error('ASS 服务尚未就绪');
    const { start, end } = selectedTimes(parseTime(startText), parseTime(endText));
    const cue: Cue = { id: `new-${crypto.randomUUID()}`, start_ms: start, end_ms: end, text: '', style: document.styles[0] };
    setDocument({ ...document, cues: [...document.cues, cue] });
    setSelectedId(cue.id); setAudition(null);
  }

  function updateCue(patch: Partial<Cue>) {
    if (!document || !selected) throw new Error('请先选择一条字幕行');
    setDocument({ ...document, cues: document.cues.map(cue => cue.id === selected.id ? { ...cue, ...patch } : cue) });
  }

  function applyTimes() {
    const { start, end } = selectedTimes(parseTime(startText), parseTime(endText));
    updateCue({ start_ms: start, end_ms: end }); setAudition(null);
  }

  async function togglePlayback() {
    if (!video || !duration) throw new Error('请先加载可播放的视频');
    if (video.paused) await video.play(); else video.pause();
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

  async function startLoop() {
    if (loop) { setAudition(null); video?.pause(); return; }
    if (!video) throw new Error('请先选择视频');
    const range = selectedTimes(parseTime(startText), parseTime(endText));
    if (range.end > duration) throw new Error('循环区间超过视频时长；字幕时间未被截断');
    await startAudition({ ...range, repeat: true });
  }

  useEffect(() => {
    if (!video || !audition) return;
    return watchPlaybackRange(video, audition, () => setAudition(null), reason => setError(reason.message));
  }, [video, audition]);

  useEffect(() => {
    const begin = () => { composing.current = true; };
    const end = () => { composing.current = false; };
    const keydown = (event: KeyboardEvent) => {
      if (busy || pendingImport) return;
      const shortcut = timingShortcut(event, composing.current);
      if (!shortcut) return;
      event.preventDefault();
      run(shortcut === 'commit' ? applyTimes : () => playTiming(shortcut));
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
  if (selected) {
    try { audioSelection = { start: parseTime(startText), end: parseTime(endText) }; }
    catch { /* A partially typed time has no drawable boundary; the editor retains its draft. */ }
  }

  async function doImport(file: File) {
    setBusy(true); setPendingImport(null); setError('');
    try {
      const imported = await importAss(file);
      setHasImportedDocument(true);
      setDocument(imported); setSelectedId(null); setAudition(null);
      setStartText('0:00:00.00'); setEndText('0:00:00.00');
    } catch (reason) {
      setError(`拒绝可编辑导入；当前字幕未被替换。${(reason as Error).message}`);
    }
    finally { setBusy(false); }
  }

  return (
    <main>
      <header className="app-header">
        <h1>CueRelay</h1>
        <div className="file-actions" aria-label="字幕文件操作">
          {/* Temporary location until the account branch adds personal display preferences. */}
          <div className="audio-mode-switch" role="group" aria-label="音频显示模式">
            <button aria-pressed={audioMode === 'waveform'} onClick={() => setAudioMode('waveform')}>Waveform</button>
            <button aria-pressed={audioMode === 'spectrum'} onClick={() => setAudioMode('spectrum')}>Spectrum</button>
          </div>
          {busy && <span role="status">正在转换…</span>}
          <label className="file-picker">
            导入 ASS
            <input aria-label="导入基础 ASS" type="file" accept=".ass" disabled={busy || !document} onChange={event => {
              const file = event.target.files?.[0];
              if (file) {
                if (document?.cues.length) setPendingImport(file);
                else void doImport(file);
              }
              event.target.value = '';
            }} />
          </label>
          <button className="primary" disabled={busy || !document} onClick={() => run(async () => {
            if (!document) return;
            setBusy(true);
            try { downloadFile(new Blob([await exportAss(document)], { type: 'text/plain;charset=utf-8' }), 'cuerelay.ass'); }
            finally { setBusy(false); }
          })}>导出 ASS</button>
        </div>
      </header>

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
          <LocalVideoPlayer onVideo={onVideo} onFile={setMediaFile} onTime={setCurrentTime} onDuration={setDuration} onError={setError} controls={<>
            <button className="playback-button" aria-label="播放 / 暂停" title="播放 / 暂停（空格）"
              disabled={!duration} onClick={() => run(togglePlayback)}>
              <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M2 3v14l8-7zM12 3h2v14h-2zM16 3h2v14h-2z" />
              </svg>
            </button>
            <div className="time-display">{formatTime(currentTime)}<span> / {formatTime(duration)}</span></div>
          </>} />
      } editor={<>
          <AudioTimeline file={mediaFile} video={video} duration={duration} currentTime={currentTime} mode={audioMode}
            selectionId={selectedId} selection={audioSelection}
            onBoundaryChange={!busy && !pendingImport && selected ? (point, time) => changeTimeDraft(point, formatTime(time)) : undefined}
            onSeek={time => run(() => {
              if (video) { setAudition(null); seekVideo(video, time); }
            })} />
          <section className="cue-editor" aria-label="字幕编辑">
            <fieldset disabled={busy || !document}>
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
                  <button className="text-button" disabled={!selected} onClick={() => {
                    if (document && selected) {
                      setDocument({ ...document, cues: document.cues.filter(cue => cue.id !== selected.id) });
                      setSelectedId(null); setAudition(null);
                    }
                  }}>删除选中行</button>
                </div>
              </div>
              <div className="time-points">
                <TimePointControl label="入点" value={startText} captureKey="I" decreaseKey="J" increaseKey="K"
                  onChange={value => changeTimeDraft('start', value)}
                  onCapture={() => run(() => capture('start'))} onNudge={delta => run(() => nudge('start', delta))} />
                <TimePointControl label="出点" value={endText} captureKey="O" decreaseKey="U" increaseKey="P"
                  onChange={value => changeTimeDraft('end', value)}
                  onCapture={() => run(() => capture('end'))} onNudge={delta => run(() => nudge('end', delta))} />
              </div>
              <div className="controls range-actions">
                <button aria-label="循环试听 [L]" aria-pressed={!!loop} onClick={() => run(startLoop)}>
                  {loop ? '停止循环' : '循环试听'} <kbd>L</kbd>
                </button>
                <button aria-label="应用时间 [Enter]" disabled={!selected} onClick={() => run(applyTimes)}>
                  应用时间 <kbd>Enter</kbd>
                </button>
                <button className="primary" aria-label="创建新行 [N]" onClick={() => run(createCue)}>
                  创建新行 <kbd>N</kbd>
                </button>
              </div>
              <label className="subtitle-input">
                字幕文本
                <textarea aria-label="字幕中文文本" rows={2} disabled={!selected} value={selected?.text || ''}
                  placeholder="先创建或选择一行字幕" onChange={event => run(() => updateCue({ text: event.target.value.replace(/\r?\n/g, '\\N') }))} />
              </label>
            </fieldset>
          </section>
      </>} />
      <CueTable cues={document?.cues || []} selectedId={selectedId} currentTime={currentTime}
        onSelect={selectCue} onLocate={cue => run(() => locate(cue))} />
    </main>
  );
}
