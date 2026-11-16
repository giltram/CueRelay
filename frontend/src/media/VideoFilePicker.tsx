import type { MessageValue } from '../contracts/messages';
import { msg } from "../i18n";
import { useLocale } from "../i18n/react";
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { pickVideoFile, supportsVideoFileHandles, type SelectedVideo } from './video-file-access';

/** Native file input remains the fallback, including unsupported browsers. */
export function VideoFilePicker({ label, children, disabled, remember = true, title, onSelect, onError }: {
  label: string; children: ReactNode; disabled: boolean; remember?: boolean; title?: string;
  onSelect: (video: SelectedVideo) => void; onError: (message: MessageValue) => void;
}) {
  useLocale();
  const input = useRef<HTMLInputElement>(null);
  const [nativeFallback, setNativeFallback] = useState(false);
  const sequence = useRef(0);
  useEffect(() => () => { sequence.current++; }, []);
  useEffect(() => { if (disabled) sequence.current++; }, [disabled]);
  return <>
    <button type="button" className="file-picker" disabled={disabled} title={title} onClick={() => {
      if (!remember || nativeFallback || !supportsVideoFileHandles()) { input.current?.click(); return; }
      const version = ++sequence.current;
      void pickVideoFile().then(selection => {
        if (selection && version === sequence.current) onSelect(selection);
      }).catch(reason => {
        if (version === sequence.current && reason?.name !== 'AbortError') {
          setNativeFallback(true);
          onError(msg("media.couldNotRememberThisVideoClickAgainTo"));
        }
      });
    }}>{children}</button>
    <input ref={input} hidden aria-label={label} type="file" accept="video/*,.mkv" disabled={disabled} onChange={event => {
      const file = event.target.files?.[0];
      if (file) { sequence.current++; onSelect({ file }); }
      event.target.value = '';
    }} />
  </>;
}
