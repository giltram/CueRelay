import { useEffect, useRef, useState } from 'react';
import JASSUB from 'jassub';
import workerUrl from 'jassub/dist/worker/worker.js?worker&url';
import wasmUrl from 'jassub/dist/wasm/jassub-worker.wasm?url';
import modernWasmUrl from 'jassub/dist/wasm/jassub-worker-modern.wasm?url';

interface Props {
  video: HTMLVideoElement | null;
  source: string | null;
  content: string;
  conversionError: string;
}

/** All rendering assets and fonts are local. No ASS parsing lives here. */
export function AssPreview({ video, source, content, conversionError }: Props) {
  const [font, setFont] = useState<File | null>(null);
  const [family, setFamily] = useState('Local Test Font');
  const [status, setStatus] = useState('选择本地字体后启用 ASS 预览');
  const [renderer, setRenderer] = useState<JASSUB | null>(null);
  const rendererRef = useRef<JASSUB | null>(null);

  useEffect(() => {
    if (!video || !font || !family.trim() || !source) {
      setStatus(!video ? '先加载本地视频，再选择字体启用预览' : '请选择本地字体，并填写字体内部族名');
      return;
    }
    let disposed = false;
    let instance: JASSUB | null = null;
    const canvas = window.document.createElement('canvas');
    canvas.className = 'ass-canvas';
    canvas.setAttribute('aria-label', 'JASSUB 字幕预览');
    video.insertAdjacentElement('afterend', canvas);
    setStatus('正在加载本地字体和 WASM…');
    const timer = setTimeout(() => {
      if (!disposed) setStatus('预览初始化超时，请检查浏览器 WASM/Worker 支持和本地资源请求');
    }, 15000);
    void font.arrayBuffer().then(async buffer => {
      if (disposed) return;
      instance = new JASSUB({
        video, canvas, workerUrl, wasmUrl, modernWasmUrl, subContent: source,
        fonts: [new Uint8Array(buffer)], defaultFont: family.trim(), queryFonts: false,
        libassMemoryLimit: 64, libassGlyphLimit: 1000,
      });
      rendererRef.current = instance;
      await instance.ready;
      if (disposed) return;
      clearTimeout(timer);
      setRenderer(instance);
      setStatus(`JASSUB 已启用 · ${crossOriginIsolated ? '跨源隔离' : '单线程降级'} · 本地字体 ${font.name}`);
    }).catch(error => {
      if (!disposed) { clearTimeout(timer); setStatus(`预览不可用：${error instanceof Error ? error.message : String(error)}`); }
      if (instance) void instance.destroy().catch(() => undefined);
      canvas.remove();
    });
    return () => {
      disposed = true;
      clearTimeout(timer);
      setRenderer(null);
      rendererRef.current = null;
      if (instance) void instance.destroy().catch(() => undefined);
      canvas.remove();
    };
  }, [video, font, family, source]);

  useEffect(() => {
    if (!renderer) return;
    let active = true;
    // Clear stale captions when the current text cannot be serialized safely.
    const update = content ? renderer.renderer.setTrack(content) : renderer.renderer.freeTrack();
    void update.then(() => {
      if (active && rendererRef.current === renderer) return renderer.resize(true);
    }).catch(error => { if (active) setStatus(`预览更新失败：${error.message}`); });
    return () => { active = false; };
  }, [content, renderer]);

  return <section className="preview-settings">
    <h2>ASS 预览</h2>
    <div className="font-inputs">
      <label>本地字体文件<input aria-label="本地字体文件" type="file" accept=".ttf,.otf,.ttc,.woff,.woff2" onChange={e => {
        const picked = e.target.files?.[0];
        if (picked && picked.size <= 30 * 1024 * 1024) setFont(picked);
        else if (picked) setStatus('字体不能超过 30MiB');
        e.target.value = '';
      }} /></label>
      <label>回退字体族名<input aria-label="回退字体族名" value={family} onChange={e => setFamily(e.target.value)} /></label>
    </div>
    <p className="hint">{status}</p>
    <p className="hint">请填写字体内部族名，并选用与 ASS 样式及 Aegisub 相同的字体。未核对字形覆盖或样式字体匹配；缺字、回退和跨设备一致性仍须目视检查。不会自动查询系统字体或远程字体。</p>
    {conversionError && <p role="alert" className="error">当前字幕无法预览 / 导出：{conversionError}</p>}
  </section>;
}
