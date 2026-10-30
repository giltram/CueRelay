import { diagnostics, safeError, reportAudio } from '../../diagnostics';
import { useEffect, useRef, useState } from 'react';
import type { AudioDisplayMode, AudioTile, AudioWorkerRequest, AudioWorkerResponse } from './analysis-types';

interface AnalysisState {
  file: File | null;
  status: 'empty' | 'opening' | 'loading' | 'ready' | 'error';
  tiles: AudioTile[];
  message: string;
  cacheBytes: number;
  decodedSegments: number;
  viewKey: string;
}

export function useAudioAnalysis(file: File | null, start: number, end: number, mode: AudioDisplayMode) {
  const worker = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const [readyFile, setReadyFile] = useState<File | null>(null);
  const viewKey = `${start}:${end}:${mode}`;
  const [state, setState] = useState<AnalysisState>({ file: null, status: 'empty', tiles: [], message: '', cacheBytes: 0, decodedSegments: 0, viewKey: '' });
  useEffect(() => {
    const scope = diagnostics.scope(), context = diagnostics.contextSnapshot();
    if (file) diagnostics.record('audio-analysis', 'open', 'start', {}, scope, context);
    setReadyFile(null);
    setState({ file, status: file ? 'opening' : 'empty', tiles: [], message: '', cacheBytes: 0, decodedSegments: 0, viewKey: '' });
    if (!file) return;
    let instance: Worker;
    try { instance = new Worker(new URL('./audio.worker.ts', import.meta.url), { type: 'module' }); }
    catch (reason) { diagnostics.record('audio-analysis', 'worker_start', 'error', { error: safeError(reason) }, scope, context); setState(s => ({ ...s, status: 'error', message: '浏览器无法启动本地音频分析 Worker' })); return; }
    worker.current = instance;
    instance.onmessage = (event: MessageEvent<AudioWorkerResponse>) => {
      const message = event.data;
      if (message.type === 'ready') { diagnostics.record('audio-analysis', 'open', 'success', {}, scope, context); setReadyFile(file); return; }
      if ('id' in message && message.id !== undefined && message.id !== requestId.current) return;
      if (message.type === 'tile') setState(s => ({ ...s, tiles: [...s.tiles.filter(t => t.start !== message.tile.start), message.tile] }));
      if (message.type === 'complete') setState(s => ({ ...s, status: 'ready', cacheBytes: message.cacheBytes, decodedSegments: message.decodedSegments }));
      if (message.type === 'error') { diagnostics.record('audio-analysis', 'worker_result', 'error', { error: message.diagnostic ?? safeError(new Error()) }, scope, context); setState(s => ({ ...s, status: 'error', message: message.message })); }
    };
    const failed = () => { diagnostics.record('audio-analysis', 'worker_communication', 'error', { error: safeError(new Error()) }, scope, context); setState(s => ({ ...s, status: 'error', message: '本地音频分析中断，可继续播放和编辑字幕' })); };
    instance.onerror = failed; instance.onmessageerror = failed;
    instance.postMessage({ type: 'open', file } satisfies AudioWorkerRequest);
    return () => {
      instance.onmessage = null; instance.onerror = null; instance.onmessageerror = null;
      instance.terminate();
      if (worker.current === instance) worker.current = null;
    };
  }, [file]);

  useEffect(() => {
    if (!file || readyFile !== file || !worker.current || end <= start) return;
    const id = ++requestId.current;
    setState(s => ({ ...s, status: 'loading', viewKey, message: '', tiles: s.tiles.filter(t => t.end > start && t.start < end) }));
    worker.current.postMessage({ type: 'view', id, start, end, mode } satisfies AudioWorkerRequest);
  }, [file, readyFile, start, end, mode]);
  useEffect(() => reportAudio('analysis', state.status), [state.status]);
  // Never show a previous file's analysis during the render before effect cleanup.
  if (state.file !== file) return { ...state, status: 'opening' as const, tiles: [], message: '' };
  if (readyFile === file && file && end > start && state.viewKey !== viewKey) return { ...state, status: 'loading' as const };
  return state;
}
