import { useEffect, useRef, useState } from 'react';
import type { AudioTile, AudioWorkerRequest, AudioWorkerResponse } from './analysis-types';

interface AnalysisState {
  file: File | null;
  status: 'empty' | 'opening' | 'loading' | 'ready' | 'error';
  tiles: AudioTile[];
  message: string;
  cacheBytes: number;
  decodedSegments: number;
}

export function useAudioAnalysis(file: File | null, start: number, end: number) {
  const worker = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const [readyFile, setReadyFile] = useState<File | null>(null);
  const [state, setState] = useState<AnalysisState>({ file: null, status: 'empty', tiles: [], message: '', cacheBytes: 0, decodedSegments: 0 });
  useEffect(() => {
    setReadyFile(null);
    setState({ file, status: file ? 'opening' : 'empty', tiles: [], message: '', cacheBytes: 0, decodedSegments: 0 });
    if (!file) return;
    let instance: Worker;
    try { instance = new Worker(new URL('./audio.worker.ts', import.meta.url), { type: 'module' }); }
    catch { setState(s => ({ ...s, status: 'error', message: '浏览器无法启动本地音频分析 Worker' })); return; }
    worker.current = instance;
    instance.onmessage = (event: MessageEvent<AudioWorkerResponse>) => {
      const message = event.data;
      if (message.type === 'ready') { setReadyFile(file); return; }
      if ('id' in message && message.id !== undefined && message.id !== requestId.current) return;
      if (message.type === 'tile') setState(s => ({ ...s, tiles: [...s.tiles.filter(t => t.start !== message.tile.start), message.tile] }));
      if (message.type === 'complete') setState(s => ({ ...s, status: 'ready', cacheBytes: message.cacheBytes, decodedSegments: message.decodedSegments }));
      if (message.type === 'error') setState(s => ({ ...s, status: 'error', message: message.message }));
    };
    instance.onerror = () => setState(s => ({ ...s, status: 'error', message: '本地音频分析中断，可继续播放和编辑字幕' }));
    instance.postMessage({ type: 'open', file } satisfies AudioWorkerRequest);
    return () => {
      instance.onmessage = null; instance.onerror = null;
      instance.terminate();
      if (worker.current === instance) worker.current = null;
    };
  }, [file]);

  useEffect(() => {
    if (!file || readyFile !== file || !worker.current || end <= start) return;
    const id = ++requestId.current;
    setState(s => ({ ...s, status: 'loading', message: '', tiles: s.tiles.filter(t => t.end > start && t.start < end) }));
    worker.current.postMessage({ type: 'view', id, start, end } satisfies AudioWorkerRequest);
  }, [file, readyFile, start, end]);
  // Never show a previous file's analysis during the render before effect cleanup.
  return state.file === file ? state : { ...state, status: 'opening' as const, tiles: [], message: '' };
}
