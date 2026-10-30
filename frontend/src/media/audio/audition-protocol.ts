import type { AudioMetadata, PcmChunk } from './local-audio';

// Two scheduled windows + one read + one transient AudioBuffer copy <= 16 MiB PCM.
export const AUDITION_WINDOW_BYTES = 4 * 1024 * 1024;
export const AUDITION_WINDOW_SECONDS = 2;
export type AuditionRequest = { type: 'open'; file: File } | { type: 'read'; start: number; end: number };
export type AuditionResponse =
  | { type: 'ready'; metadata: AudioMetadata }
  | { type: 'pcm'; chunks: PcmChunk[] }
  | { type: 'error'; diagnostic?: import('../../diagnostics/schema').SafeError; message: string };

export function auditionWindowSeconds(metadata: AudioMetadata): number {
  return Math.min(AUDITION_WINDOW_SECONDS,
    Math.floor(AUDITION_WINDOW_BYTES / (metadata.channels * 4)) / metadata.sampleRate);
}
