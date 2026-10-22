import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssDocument, Cue } from '../contracts/subtitles';
import { LocalVideoPlayer } from '../media/LocalVideoPlayer';
import { SeekDiagnostics } from '../media/SeekDiagnostics';
import { allowsShortcut, formatTime, parseTime, seekVideo, snapTime, validateInterval } from '../media/playback';
import { downloadFile, exportAss, importAss, loadEmptyDocument } from '../project-data/ass-api';
import { AssPreview } from '../ass-preview/AssPreview';
import { CueTable } from './CueTable';

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

  return <main>
    <header><div className="brand"><span className="brand-mark">C</span><div><h1>CueRelay</h1><p>本地媒体 / 打轴 / ASS 验证台</p></div></div><span className="badge">首个 Coding Task</span></header>
    <div className="storage-notice"><strong>尚未持久保存</strong><span>字幕仅在本页内存中。请导出 ASS 保留工作；刷新或关闭会丢失修改。当前没有自动保存、项目存储或多人协作。</span></div>
    <div className="file-bar">
      <label className="file-picker">导入基础 ASS<input aria-label="导入基础 ASS" type="file" accept=".ass" disabled={busy || !document} onChange={e => {
        const file = e.target.files?.[0];
        if (file) { if (document?.cues.length) setPendingImport(file); else void doImport(file); }
        e.target.value = '';
      }} /></label>
      <button className="primary" disabled={busy || !document} onClick={() => run(async () => {
        if (!document) return;
        setBusy(true);
        try { downloadFile(new Blob([await exportAss(document)], { type: 'text/plain;charset=utf-8' }), 'cuerelay.ass'); }
        finally { setBusy(false); }
      })}>导出 ASS</button>
      <button disabled={!original} onClick={() => original && downloadFile(original, original.name)}>下载导入原件</button>
      {rejectedOriginal && <button onClick={() => downloadFile(rejectedOriginal, rejectedOriginal.name)}>下载被拒原件</button>}
      <span className="hint">{busy ? '正在转换…' : original ? `最近选中的原件：${original.name}` : '仅字幕转换会请求本地后端'}</span>
    </div>
    {pendingImport && <div role="alert" className="confirm">导入「{pendingImport.name}」将替换当前内存字幕，请先导出需要的修改。
      <button onClick={() => void doImport(pendingImport)}>替换当前字幕</button><button onClick={() => setPendingImport(null)}>取消</button></div>}
    {error && <div className="error" role="alert">{error}</div>}
    {outsideDuration && <div className="warning">部分字幕超出视频报告时长；时间保持原值，请核对片源。</div>}
    <div className="workbench">
      <div className="media-column">
        <LocalVideoPlayer onVideo={onVideo} onTime={setCurrentTime} onDuration={setDuration} onError={setError} />
        <section className="transport"><div className="time-display">{formatTime(currentTime)}<small> / {formatTime(duration)}</small></div>
          <div className="controls"><button disabled={!duration} onClick={() => run(togglePlayback)}>播放 / 暂停</button>
            <label>跳转<input aria-label="跳转时间" value={jumpText} onChange={e => setJumpText(e.target.value)} /></label>
            <button onClick={() => run(() => { if (!video) throw new Error('请先选择视频'); setLoop(null); video.pause(); seekVideo(video, parseTime(jumpText)); })}>定位时间</button></div>
          <p className="hint">时间为百分秒网格；寻址和 10ms 微调不代表可靠逐帧。循环使用浏览器播放时钟，边界可能有延迟。</p>
        </section>
        <AssPreview video={duration > 0 ? video : null} source={document?.source || null}
          content={previewContent} conversionError={previewError} />
        {!loop && <SeekDiagnostics video={video} duration={duration} />}
      </div>
      <section className="cue-editor"><div className="section-heading"><h2>{selected ? '编辑选中行' : '采集新区间'}</h2><span>{selected ? selected.style : '10ms 时间网格'}</span></div>
        <fieldset disabled={busy || !document}><legend className="sr-only">字幕编辑</legend>
          <div className="point-group"><label>入点<input aria-label="入点" value={startText} onChange={e => { setStartText(e.target.value); setLoop(null); }} /></label>
            <div className="controls"><button onClick={() => run(() => capture('start'))}>设为当前 [I]</button><button onClick={() => run(() => nudge('start', -10))}>−10ms [J]</button><button onClick={() => run(() => nudge('start', 10))}>+10ms [K]</button></div></div>
          <div className="point-group"><label>出点<input aria-label="出点" value={endText} onChange={e => { setEndText(e.target.value); setLoop(null); }} /></label>
            <div className="controls"><button onClick={() => run(() => capture('end'))}>设为当前 [O]</button><button onClick={() => run(() => nudge('end', -10))}>−10ms [U]</button><button onClick={() => run(() => nudge('end', 10))}>+10ms [P]</button></div></div>
          <div className="controls editor-actions"><button className="primary" onClick={() => run(createCue)}>创建新行 [N]</button><button disabled={!selected} onClick={() => run(applyTimes)}>应用时间 [Enter]</button><button aria-pressed={!!loop} onClick={() => run(startLoop)}>{loop ? '停止循环' : '循环试听 [L]'}</button></div>
          <p className="hint">入出点是待应用区间。微调后用「应用时间」写入选中行，或「创建新行」。</p>
          <label>中文 / 原始 ASS 文本<textarea aria-label="字幕中文文本" rows={5} disabled={!selected} value={selected?.text || ''} placeholder="先创建或选择一行。换行使用 \\N；保留 ASS 标签。" onChange={e => run(() => updateCue({ text: e.target.value.replace(/\r?\n/g, '\\N') }))} /></label>
          <div className="controls"><label>样式<select aria-label="字幕样式" disabled={!selected} value={selected?.style || document?.styles[0] || ''} onChange={e => run(() => updateCue({ style: e.target.value }))}>{document?.styles.map(style => <option key={style}>{style}</option>)}</select></label>
            <button disabled={!selected} onClick={() => run(() => selected && locate(selected))}>定位选中行</button>
            <button disabled={!selected} onClick={() => { if (document && selected) { setDocument({ ...document, cues: document.cues.filter(cue => cue.id !== selected.id) }); setSelectedId(null); setLoop(null); } }}>删除选中行</button></div>
        </fieldset>
        <p className="hint">文本和样式即时写入页面内存；不支持的标签会阻止预览与导出，不会被静默删除。</p>
        <details><summary>基础快捷键</summary><p>空格 播放/暂停 · I/O 采集入/出点 · N 新行 · J/K 入点 ±10ms · U/P 出点 ±10ms · L 循环 · Enter 应用时间。</p><p>先点击页面空白处启用；输入框、按钮、视频控件、修饰键与中文输入法组合输入期间不触发。</p></details>
      </section>
    </div>
    <CueTable cues={document?.cues || []} selectedId={selectedId} currentTime={currentTime} onSelect={selectCue} onLocate={cue => run(() => locate(cue))} />
    <footer>本地验证工具 · 没有业务数据库 · 原件下载与编辑稿导出分开 · 播放能力以实际片源验证为准</footer>
  </main>;
}
