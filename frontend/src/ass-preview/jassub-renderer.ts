import JASSUB from 'jassub';
import workerUrl from 'jassub/dist/worker/worker.js?worker&url';
import wasmUrl from 'jassub/dist/wasm/jassub-worker.wasm?url';
import modernWasmUrl from 'jassub/dist/wasm/jassub-worker-modern.wasm?url';
import fontUrl from './fonts/NotoSansSC-Regular.otf?url';
import type { PreviewRenderer } from './preview-session';

// 2.5.23's automatic BT709 -> BT601 WebGL matrix tints even neutral white
// (its columns sum to unequal RGB values). Preserve script RGB, as the ASS
// exporter does, rather than changing colors based on browser video metadata.
class PreviewJassub extends JASSUB {
  override _updateColorSpace() {}

  override manualRender(data: Parameters<JASSUB['manualRender']>[0], repaint = false) {
    const video = this._video;
    // A paused/seeked frame can arrive after our explicit repaint. Its PTS may
    // precede currentTime (e.g. 1.84s for a 1.87s seek), crossing an ASS boundary
    // and undoing the correct final image. Playback still follows video frames.
    const frame = video && (video.paused || video.seeking)
      ? { ...data, mediaTime: video.currentTime } : data;
    return super.manualRender(frame, repaint);
  }
}

/** All version-specific JASSUB calls and resource ownership stay here. */
export function createJassubRenderer(video: HTMLVideoElement, content: string, onFailure: (error: Error) => void): PreviewRenderer {
  const canvas = document.createElement('canvas');
  canvas.className = 'ass-preview-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.visibility = 'hidden';
  video.insertAdjacentElement('afterend', canvas);
  const controller = new AbortController();
  let instance: JASSUB | undefined;
  let destroyed = false;
  let timeout: ReturnType<typeof setTimeout>;
  let rejectWorker: (error: Error) => void;
  const workerFailure = new Promise<never>((_resolve, reject) => { rejectWorker = reject; });
  const workerError = (event: Event) => {
    event.preventDefault();
    const error = new Error('Worker / WASM 无法运行，请检查浏览器兼容性和本地资源');
    rejectWorker(error); onFailure(error);
  };
  const repaint = async () => {
    if (destroyed || !instance || !video.videoWidth || !video.videoHeight) return;
    await instance.manualRender({ mediaTime: video.currentTime, width: video.videoWidth,
      height: video.videoHeight, expectedDisplayTime: performance.now() }, true);
  };
  const onRepaint = () => { void repaint().catch(error => { if (!destroyed) onFailure(error); }); };
  const onResize = () => { if (instance && !destroyed) void instance.resize(true).then(repaint).catch(onFailure); };
  const ready = Promise.race([workerFailure, (async () => {
    if (!globalThis.Worker || !globalThis.OffscreenCanvas || !globalThis.WebAssembly || !canvas.transferControlToOffscreen) {
      throw new Error('浏览器缺少 Worker、WebAssembly 或 OffscreenCanvas 支持');
    }
    // Fetch explicitly: JASSUB's URL font loader uses allSettled and may silently
    // continue without a font. A failed bundled font must be a visible failure.
    const response = await fetch(fontUrl, { signal: controller.signal });
    if (!response.ok) throw new Error('内置中文字体加载失败');
    const font = new Uint8Array(await response.arrayBuffer());
    if (destroyed) return;
    // Canvas-only initialization avoids JASSUB starting uncaught async video
    // callbacks before WASM has initialized successfully.
    instance = new PreviewJassub({ canvas, subContent: content, workerUrl, wasmUrl, modernWasmUrl,
      fonts: [font], defaultFont: 'Noto Sans SC', queryFonts: false });
    instance._worker.addEventListener('error', workerError);
    instance._worker.addEventListener('messageerror', workerError);
    await instance.ready;
    if (destroyed) return;
    await instance.setVideo(video);
    if (destroyed) return;
    for (const event of ['seeked', 'loadeddata', 'pause']) video.addEventListener(event, onRepaint);
    document.addEventListener('fullscreenchange', onResize);
    await instance.resize(true);
    await repaint();
  })()]).finally(() => clearTimeout(timeout));
  timeout = setTimeout(() => {
    const error = new Error('渲染资源加载超时');
    rejectWorker(error); onFailure(error);
  }, 20000);

  return {
    ready,
    async setTrack(track) {
      await ready;
      if (destroyed || !instance) return;
      await instance.renderer.setTrack(track);
      await repaint(); // A paused video will not emit a new video frame on edit.
    },
    setVisible(visible) { canvas.style.visibility = visible ? 'visible' : 'hidden'; },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(timeout); controller.abort();
      canvas.remove();
      for (const event of ['seeked', 'loadeddata', 'pause']) video.removeEventListener(event, onRepaint);
      document.removeEventListener('fullscreenchange', onResize);
      if (!instance) return;
      const engine = instance;
      engine._worker.removeEventListener('error', workerError);
      engine._worker.removeEventListener('messageerror', workerError);
      // 2.5.23 destroy waits on ready/releaseProxy. A failed worker can leave
      // either pending forever. Bound shutdown, including initialization failure.
      const termination = setTimeout(() => engine._worker.terminate(), 250);
      void engine.destroy().catch(() => {}).finally(() => clearTimeout(termination));
    },
  };
}
