import type { AudioMetadata } from './local-audio';

export const AUDIO_SEGMENT_SECONDS = 2;
export const AUDIO_CACHE_BYTES = 32 * 1024 * 1024;
export const WAVEFORM_BINS = 4096;

export interface PcmSegment {
  start: number;
  end: number;
  sampleRate: number;
  channels: Float32Array[];
}

export interface AudioTile {
  start: number;
  end: number;
  /** Interleaved minima/maxima across all channels, preserving opposite-phase audio. */
  peaks: Float32Array;
}

export type AudioWorkerRequest =
  | { type: 'open'; file: File }
  | { type: 'view'; id: number; start: number; end: number };
export type AudioWorkerResponse =
  | { type: 'ready'; metadata: AudioMetadata }
  | { type: 'tile'; id: number; tile: AudioTile }
  | { type: 'complete'; id: number; cacheBytes: number; decodedSegments: number }
  | { type: 'error'; id?: number; message: string };
