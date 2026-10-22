import { useEffect, useRef, useState } from 'react';

interface Measurement {
  requested_ms: number;
  seeked_ms: number | null;
  frame_callback_ms: number | null;
  frame_media_ms: number | null;
  delta_ms: number | null;
}

function measure(video: HTMLVideoElement, requested: number, signal: AbortSignal): Promise<Measurement> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    let seeked: number | null = null;
    let frameTime: number | null = null;
    let callbackTime: number | null = null;
    let callbackId = 0;
    const supported = typeof video.requestVideoFrameCallback === 'function';
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener('seeked', onSeeked);
      signal.removeEventListener('abort', onAbort);
      if (callbackId) video.cancelVideoFrameCallback(callbackId);
    };
    const finish = () => {
      cleanup();
      resolve({ requested_ms: requested, seeked_ms: seeked, frame_callback_ms: callbackTime,
        frame_media_ms: frameTime, delta_ms: frameTime === null ? null : frameTime - requested });
    };
    const onSeeked = () => {
      seeked = performance.now() - start;
      if (!supported || frameTime !== null) finish();
    };
    const onAbort = () => { cleanup(); reject(new Error('测量已取消')); };
    const timeout = setTimeout(finish, 3000);
    signal.addEventListener('abort', onAbort, { once: true });
    video.addEventListener('seeked', onSeeked, { once: true });
    if (supported) callbackId = video.requestVideoFrameCallback((_now, metadata) => {
      frameTime = metadata.mediaTime * 1000;
      callbackTime = performance.now() - start;
      if (seeked !== null) finish();
    });
    video.currentTime = requested / 1000;
  });
}

/** A local validation aid: timings/metadata only, never pixels or network I/O. */
export function SeekDiagnostics({ video, duration }: { video: HTMLVideoElement | null; duration: number }) {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState('');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), [video]);

  async function run() {
    if (!video || !duration) return;
    controller.current = new AbortController();
    const signal = controller.current.signal;
    const previous = video.currentTime;
    video.pause();
    setRunning(true); setReport('正在暂停视频并抽测 20 个定位点，请勿同时操作播放器…');
    try {
      const measurements: Measurement[] = [];
      for (let i = 0; i < 20; i++) {
        if (signal.aborted) throw new Error('测量已取消');
        const requested = Math.round((duration * ((i * 7 % 20 + 0.37) / 20)) / 10) * 10;
        measurements.push(await measure(video, requested, signal));
      }
      setReport(JSON.stringify({
        browser: navigator.userAgent, cross_origin_isolated: crossOriginIsolated,
        logical_cores: navigator.hardwareConcurrency, duration_ms: duration,
        note: 'frame_callback_ms 是浏览器呈现帧回调耗时，非目视画面稳定保证；delta_ms 是帧媒体时间减请求时间，真实参考帧误差需人工核对。',
        measurements,
      }, null, 2));
    } catch (reason) { setReport((reason as Error).message); }
    finally {
      if (!signal.aborted) video.currentTime = previous;
      setRunning(false);
    }
  }

  return <details className="seek-diagnostics"><summary>本机定位测量（实验辅助）</summary>
    <p className="hint">暂停并抽测 20 点；记录 seeked 与呈现帧回调耗时、帧媒体时间差。不是逐帧精度认证。请先停止循环，测量期间勿操作视频。</p>
    <button disabled={!duration || running} onClick={() => void run()}>测量 20 个定位点</button>
    {running && <button onClick={() => controller.current?.abort()}>取消测量</button>}
    {report && <textarea aria-label="定位测量结果" readOnly rows={8} value={report} />}
  </details>;
}
