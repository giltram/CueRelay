import { useCallback, useEffect, useRef, useState } from 'react';
import { diagnostics } from '../diagnostics';
import type { MediaManifest } from '../contracts/projects';
import { hashFile, matchesMedia } from './media-manifest';
import { readVideoHandle, rememberVideoHandle, supportsVideoFileHandles, type InitialVideo, type SelectedVideo, type VideoFileHandle } from './video-file-access';

/** Owns source selection/verification. Playback and Object URLs stay in LocalVideoPlayer. */
export function useVideoSource({ expectedMedia, initialMedia, persistenceKey, enabled, onError, onVerifiedChange, onDuration }: {
  expectedMedia?: MediaManifest; initialMedia?: InitialVideo; persistenceKey?: string; enabled: boolean;
  onError: (message: string) => void; onVerifiedChange?: (verified: boolean) => void; onDuration: (milliseconds: number) => void;
}) {
  const [selection, setSelection] = useState<SelectedVideo | null>(() => initialMedia && expectedMedia &&
    matchesMedia(initialMedia.file, initialMedia.sha256, expectedMedia) ? initialMedia : null);
  const selected = useRef(selection); selected.current = selection;
  const [locked, setLocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState(0);
  const [notice, setNotice] = useState('');
  const [authorization, setAuthorization] = useState<VideoFileHandle | null>(null);
  const task = useRef<AbortController | null>(null);
  const saved = useRef<SelectedVideo | null>(null);

  const cancel = useCallback(() => { task.current?.abort(); setChecking(false); }, []);
  const begin = useCallback(() => {
    task.current?.abort();
    const next = new AbortController(); task.current = next;
    setChecking(true); setProgress(0); setNotice(''); setAuthorization(null); onError('');
    onVerifiedChange?.(false);
    return next;
  }, [onError, onVerifiedChange]);

  const verify = useCallback(async (value: SelectedVideo, operation: AbortController) => {
    if (expectedMedia) {
      if (value.file.size !== expectedMedia.size) throw new Error('片源大小与项目基准不一致，请选择同一视频。');
      const digest = await hashFile(value.file, operation.signal, ratio => {
        if (!operation.signal.aborted) setProgress(ratio);
      });
      if (!matchesMedia(value.file, digest, expectedMedia)) throw new Error('片源 SHA-256 与项目基准不一致，字幕未被修改。');
    }
    operation.signal.throwIfAborted();
    setSelection(value);
  }, [expectedMedia]);

  const choose = useCallback(async (value: SelectedVideo) => {
    diagnostics.record('media', 'select_file', 'start');
    const operation = begin();
    try { await verify(value, operation); }
    catch (reason) { if (!operation.signal.aborted) onError((reason as Error).message); }
    finally { if (task.current === operation) setChecking(false); }
  }, [begin, verify, onError]);

  const restore = useCallback(async (key: string, handle?: VideoFileHandle, permission?: Promise<PermissionState>) => {
    const operation = begin();
    try {
      const remembered = handle ?? await readVideoHandle(key);
      operation.signal.throwIfAborted();
      if (!remembered) return;
      const access = permission ? await permission : await remembered.queryPermission({ mode: 'read' });
      operation.signal.throwIfAborted();
      if (access !== 'granted') {
        setAuthorization(remembered); setNotice('需要授权才能重新读取上次的视频。'); return;
      }
      let file: File;
      try { file = await remembered.getFile(); }
      catch { throw new Error('无法读取上次的视频，文件可能已移动、删除或设备未连接。请重新导入。'); }
      operation.signal.throwIfAborted();
      await verify({ file, handle: remembered }, operation);
    } catch (reason) {
      if (!operation.signal.aborted) {
        const error = reason as Error;
        onError(error.name === 'NotAllowedError' ? '视频读取未获授权，请重新导入或授权。'
          : error.name === 'Error' ? error.message : '无法恢复本机视频，请重新导入。');
      }
    } finally { if (task.current === operation) setChecking(false); }
  }, [begin, verify, onError]);

  useEffect(() => {
    if (enabled && persistenceKey && !selected.current && supportsVideoFileHandles()) void restore(persistenceKey);
    return () => { task.current?.abort(); setChecking(false); };
  }, [enabled, persistenceKey, restore]);

  function authorize() {
    if (!authorization || !persistenceKey || !enabled) return;
    // Permission must be requested synchronously inside this click, before any storage awaits.
    const permission = authorization.requestPermission({ mode: 'read' });
    void restore(persistenceKey, authorization, permission);
  }

  function loaded(duration: number) {
    if (!selected.current) return;
    if (!Number.isFinite(duration) || duration <= 0 || duration >= 36000) {
      failed('视频时长无效或超过验证台 10 小时范围，请选择其他文件'); return;
    }
    setLocked(true); onDuration(duration * 1000); onVerifiedChange?.(true);
    if (persistenceKey && enabled && saved.current !== selected.current) {
      saved.current = selected.current;
      const operation = task.current;
      void rememberVideoHandle(persistenceKey, selected.current.handle).catch(() => {
        if (!operation?.signal.aborted) setNotice('本次视频可正常使用，但无法记住文件；下次可能需要重新导入。');
      });
    }
  }

  function failed(message: string) {
    onVerifiedChange?.(false); onDuration(0); onError(message);
    if (!locked) { setSelection(null); setLocked(false); }
  }

  return { file: selection?.file ?? null, locked, checking, progress, notice, needsAuthorization: Boolean(authorization),
    choose, cancel, authorize, loaded, failed };
}
