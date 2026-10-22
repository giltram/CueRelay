import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssDocument, Cue } from '../contracts/subtitles';
import { LocalVideoPlayer } from '../media/LocalVideoPlayer';
import { SeekDiagnostics } from '../media/SeekDiagnostics';
import { allowsShortcut, formatTime, parseTime, seekVideo, snapTime, validateInterval } from '../media/playback';
import { downloadFile, exportAss, importAss, loadEmptyDocument } from '../project-data/ass-api';
import { AssPreview } from '../ass-preview/AssPreview';
import { CueTable } from './CueTable';
import { TimePointControl } from './TimePointControl';

export function EditorWorkbench() {
  const [document, setDocument] = useState<AssDocument | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [startText, setStartText] = useState('0:00:00.00');
  const [endText, setEndText] = useState('0:00:00.00');
  const [jumpText, setJumpText] = useState('0:00:00.00');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loop, setLoop] = useState<{ start: number; end: number } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [original, setOriginal] = useState<File | null>(null);
  const [rejectedOriginal, setRejectedOriginal] = useState<File | null>(null);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const [previewContent, setPreviewContent] = useState('');
  const [previewError, setPreviewError] = useState('');
  const composing = useRef(false);
  const selected = document?.cues.find(cue => cue.id === selectedId);

  useEffect(() => {
    let active = true;
    loadEmptyDocument().then(value => { if (active) setDocument(value); })
      .catch(() => { if (active) setError('无法连接 ASS 服务，请按 README 启动 Django，然后刷新页面'); });
    return () => { active = false; };
  }, []);

  // Orchestrate HTTP conversion here; the renderer never depends on the client.
  useEffect(() => {
    const controller = new AbortController();
    setPreviewContent(''); setPreviewError('');
    if (!document) return;
    const timer = setTimeout(() => {
      exportAss(document, controller.signal).then(content => {
        if (!controller.signal.aborted) setPreviewContent(content);
      }).catch(reason => {
        if (!controller.signal.aborted) setPreviewError(reason.message);
      });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [document]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (document && (document.cues.length > 0 || original)) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [document, original]);

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
    setSelectedId(cue.id); setStartText(formatTime(cue.start_ms)); setEndText(formatTime(cue.end_ms)); setLoop(null);
  }

  function locate(cue: Cue) {
    if (!video) throw new Error('请先选择视频');
    selectCue(cue); video.pause(); seekVideo(video, cue.start_ms);
  }

  function capture(which: 'start' | 'end') {
    if (!video || !duration) throw new Error('请先加载可播放的视频');
    const value = formatTime(snapTime(video.currentTime));
    if (which === 'start') setStartText(value); else setEndText(value);
    setLoop(null);
  }

  function nudge(which: 'start' | 'end', delta: number) {
    const value = parseTime(which === 'start' ? startText : endText) + delta;
    if (value < 0 || value > 35_999_990) throw new Error('微调时间超出范围');
    if (which === 'start') setStartText(formatTime(value)); else setEndText(formatTime(value));
    setLoop(null);
  }

  function createCue() {
    if (!document) throw new Error('ASS 服务尚未就绪');
    const { start, end } = selectedTimes(parseTime(startText), parseTime(endText));
    const cue: Cue = { id: `new-${crypto.randomUUID()}`, start_ms: start, end_ms: end, text: '', style: document.styles[0] };
    setDocument({ ...document, cues: [...document.cues, cue] });
    setSelectedId(cue.id); setLoop(null);
  }

  function updateCue(patch: Partial<Cue>) {
    if (!document || !selected) throw new Error('请先选择一条字幕行');
    setDocument({ ...document, cues: document.cues.map(cue => cue.id === selected.id ? { ...cue, ...patch } : cue) });
  }

  function applyTimes() {
    const { start, end } = selectedTimes(parseTime(startText), parseTime(endText));
    updateCue({ start_ms: start, end_ms: end }); setLoop(null);
  }

  async function togglePlayback() {
    if (!video || !duration) throw new Error('请先加载可播放的视频');
    if (video.paused) await video.play(); else video.pause();
  }

  async function startLoop() {
    if (loop) { setLoop(null); video?.pause(); return; }
    if (!video) throw new Error('请先选择视频');
    const range = selectedTimes(parseTime(startText), parseTime(endText));
    if (range.end > duration) throw new Error('循环区间超过视频时长；字幕时间未被截断');
    seekVideo(video, range.start);
    await video.play();
    setLoop(range);
  }

  useEffect(() => {
    if (!video || !loop) return;
    let frame = 0;
    const tick = () => {
      if (!video.paused && (video.currentTime * 1000 >= loop.end || video.currentTime * 1000 < loop.start)) {
        video.currentTime = loop.start / 1000;
      }
      frame = requestAnimationFrame(tick);
    };
    const ended = () => {
      video.currentTime = loop.start / 1000;
      void video.play().catch(reason => { setError(reason.message); setLoop(null); });
    };
    frame = requestAnimationFrame(tick);
    video.addEventListener('ended', ended);
    return () => { cancelAnimationFrame(frame); video.removeEventListener('ended', ended); };
  }, [video, loop]);

  useEffect(() => {
    const begin = () => { composing.current = true; };
    const end = () => { composing.current = false; };
    const keydown = (event: KeyboardEvent) => {
      if (!allowsShortcut(event, composing.current) || busy || pendingImport) return;
      const actions: Record<string, () => void | Promise<void>> = {
        Space: togglePlayback, KeyI: () => capture('start'), KeyO: () => capture('end'),
        KeyN: createCue, KeyL: startLoop,
        KeyJ: () => nudge('start', -10), KeyK: () => nudge('start', 10),
        KeyU: () => nudge('end', -10), KeyP: () => nudge('end', 10),
        Enter: applyTimes,
      };
      const action = actions[event.code];
      if (action) { event.preventDefault(); run(action); }
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

  async function doImport(file: File) {
    setBusy(true); setPendingImport(null); setError('');
    try {
      const imported = await importAss(file);
      setOriginal(file); setRejectedOriginal(null);
      setDocument(imported); setSelectedId(null); setLoop(null);
      setStartText('0:00:00.00'); setEndText('0:00:00.00');
    } catch (reason) {
      setRejectedOriginal(file);
      setError(`拒绝可编辑导入；当前字幕未被替换。${(reason as Error).message}`);
    }
    finally { setBusy(false); }
  }

  return (
    <main>
      <header className="app-header">
        <h1>CueRelay</h1>
        <div className="file-actions" aria-label="字幕文件操作">
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

      <div className="document-bar">
        <p className="storage-notice"><strong>尚未持久保存</strong> · 关闭或刷新前请导出 ASS。</p>
        {busy && <span role="status">正在转换…</span>}
        {(original || rejectedOriginal) && (
          <details className="source-files">
            <summary>导入原件</summary>
            {original && <button onClick={() => downloadFile(original, original.name)}>下载导入原件：{original.name}</button>}
            {rejectedOriginal && <button onClick={() => downloadFile(rejectedOriginal, rejectedOriginal.name)}>下载被拒原件：{rejectedOriginal.name}</button>}
          </details>
        )}
      </div>

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

      <div className="workbench">
        <LocalVideoPlayer onVideo={onVideo} onTime={setCurrentTime} onDuration={setDuration} onError={setError} />

        <section className="cue-editor">
          <h2>{selected ? '编辑字幕' : '采集区间'}</h2>
          <fieldset disabled={busy || !document}>
            <legend className="sr-only">字幕编辑</legend>
            <div className="time-points">
              <TimePointControl label="入点" value={startText} captureKey="I" decreaseKey="J" increaseKey="K"
                onChange={value => { setStartText(value); setLoop(null); }}
                onCapture={() => run(() => capture('start'))} onNudge={delta => run(() => nudge('start', delta))} />
              <TimePointControl label="出点" value={endText} captureKey="O" decreaseKey="U" increaseKey="P"
                onChange={value => { setEndText(value); setLoop(null); }}
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
            <p className="hint">微调后应用到选中行，或按此区间创建新行。</p>

            <label className="subtitle-input">
              字幕文本
              <textarea aria-label="字幕中文文本" rows={4} disabled={!selected} value={selected?.text || ''}
                placeholder="先创建或选择一行字幕" onChange={event => run(() => updateCue({ text: event.target.value.replace(/\r?\n/g, '\\N') }))} />
            </label>
            <p className="hint">换行会转为 ASS 的 \N。文本与样式即时写入本页，不支持的标签会阻止预览和导出。</p>
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
                  setSelectedId(null); setLoop(null);
                }
              }}>删除选中行</button>
            </div>
          </fieldset>
          <details className="shortcut-help">
            <summary>快捷键与时间说明</summary>
            <dl className="shortcut-list">
              <div><dt><kbd>Space</kbd></dt><dd>播放 / 暂停</dd></div>
              <div><dt><kbd>I</kbd> / <kbd>O</kbd></dt><dd>采集入点 / 出点</dd></div>
              <div><dt><kbd>J</kbd> / <kbd>K</kbd></dt><dd>入点 −10 / +10ms</dd></div>
              <div><dt><kbd>U</kbd> / <kbd>P</kbd></dt><dd>出点 −10 / +10ms</dd></div>
              <div><dt><kbd>L</kbd></dt><dd>开始 / 停止循环</dd></div>
              <div><dt><kbd>N</kbd> / <kbd>Enter</kbd></dt><dd>创建新行 / 应用时间</dd></div>
            </dl>
            <p className="hint">点击操作按钮后仍可使用字母快捷键。空格、Enter 保留按钮的原生操作。输入框、视频控件和中文输入法组合输入期间不触发。</p>
            <p className="hint">时间吸附到 10ms 网格；寻址不代表可靠逐帧，循环边界可能有延迟。字幕仅保存在本页，暂无自动保存或多人协作。</p>
          </details>
        </section>

        <div className="media-tools">
          <section className="transport" aria-label="播放控制">
            <div className="transport-position">
              <div className="time-display">{formatTime(currentTime)}<span> / {formatTime(duration)}</span></div>
              <button aria-label="播放 / 暂停" disabled={!duration} onClick={() => run(togglePlayback)}>
                播放 / 暂停 <kbd>Space</kbd>
              </button>
            </div>
            <div className="jump-controls">
              <label>跳转时间<input aria-label="跳转时间" value={jumpText} onChange={event => setJumpText(event.target.value)} /></label>
              <button onClick={() => run(() => {
                if (!video) throw new Error('请先选择视频');
                setLoop(null); video.pause(); seekVideo(video, parseTime(jumpText));
              })}>定位时间</button>
            </div>
          </section>
          <AssPreview video={duration > 0 ? video : null} source={document?.source || null}
            content={previewContent} conversionError={previewError} />
          {!loop && <SeekDiagnostics video={video} duration={duration} />}
        </div>
      </div>
      <CueTable cues={document?.cues || []} selectedId={selectedId} currentTime={currentTime}
        onSelect={selectCue} onLocate={cue => run(() => locate(cue))} />
    </main>
  );
}
