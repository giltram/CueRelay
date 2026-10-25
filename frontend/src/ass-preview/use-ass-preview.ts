import { useEffect, useRef, useState } from 'react';
import type { AssDocument } from '../contracts/subtitles';
import { createJassubRenderer } from './jassub-renderer';
import { PreviewSession, type PreviewStatus } from './preview-session';

type Serialize = (document: AssDocument, signal: AbortSignal) => Promise<string>;

/** Media identity controls lifetime; document identity only updates the track. */
export function useAssPreview(video: HTMLVideoElement | null, media: File | MediaStream | null,
  document: AssDocument | null, serialize: Serialize, visible: boolean) {
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState<PreviewStatus>({ phase: 'loading' });
  const session = useRef<PreviewSession | null>(null);
  const latest = useRef(document); latest.current = document;
  useEffect(() => {
    if (!video || !media || !enabled) return;
    setStatus({ phase: 'loading' });
    const current = new PreviewSession({ serialize,
      createRenderer: (content, onFailure) => createJassubRenderer(video, content, onFailure),
      onStatus: setStatus });
    session.current = current;
    if (latest.current) current.update(latest.current);
    return () => { session.current = null; current.dispose(); };
  }, [video, media, serialize, enabled]);
  useEffect(() => { if (document) session.current?.update(document); }, [document, video, media, enabled]);
  useEffect(() => { session.current?.setVisible(visible); }, [visible, video, media, enabled]);
  return { enabled, setEnabled, status, active: Boolean(video && media && enabled) };
}
