import { diagnostics, safeError } from '../diagnostics';
import type { MediaManifest } from '../contracts/projects';

function videoDuration(file: File, signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      video.onloadeddata = null; video.onerror = null;
      const duration = Math.round(video.duration * 1000);
      video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
      if (error) reject(error);
      else if (!Number.isFinite(duration) || duration <= 0 || duration >= 36_000_000) reject(new Error('视频时长须在 0–10 小时之间。'));
      else resolve(duration);
    };
    const abort = () => finish(new DOMException('已取消', 'AbortError'));
    const timeout = window.setTimeout(() => finish(new Error('视频加载超时，请检查格式并重试。')), 30000);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    video.onloadeddata = () => finish();
    video.onerror = () => finish(new Error('浏览器无法播放此视频，请检查容器和编码。'));
    video.muted = true; video.preload = 'auto'; video.src = url; video.load();
  });
}

export function hashFile(file: File, signal: AbortSignal, progress: (ratio: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const scope = diagnostics.scope(), context = diagnostics.contextSnapshot();
    diagnostics.record('media', 'validation', 'start', {}, scope, context);
    const worker = new Worker(new URL('./file-hash.worker.ts', import.meta.url), { type: 'module' });
    const finish = (error?: Error, digest?: string) => {
      worker.terminate(); signal.removeEventListener('abort', abort);
      diagnostics.record('media', 'validation', error ? error.name === 'AbortError' ? 'cancelled' : 'error' : 'success', error ? { error: safeError(error) } : {}, scope, context);
      if (error) reject(error); else resolve(digest!);
    };
    const abort = () => finish(new DOMException('已取消', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    worker.onmessage = event => {
      if (event.data.error) finish(new Error(event.data.error));
      else if (event.data.digest) finish(undefined, event.data.digest);
      else progress(event.data.ratio);
    };
    worker.onmessageerror = () => finish(new Error('校验 Worker 通信失败'));
    worker.onerror = () => finish(new Error('视频校验无法启动，请重试。'));
    worker.postMessage(file);
  });
}

export async function createMediaManifest(file: File, signal: AbortSignal, progress: (ratio: number) => void): Promise<MediaManifest> {
  if (!file.size || !Number.isSafeInteger(file.size)) throw new Error('视频文件大小无效。');
  const duration_ms = await videoDuration(file, signal);
  signal.throwIfAborted();
  const sha256 = await hashFile(file, signal, progress);
  return { sha256, size: file.size, duration_ms };
}

export function matchesMedia(file: Pick<File, 'size'>, digest: string, expected: MediaManifest): boolean {
  return file.size === expected.size && digest === expected.sha256;
}
