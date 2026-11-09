import { afterEach, expect, it, vi } from 'vitest';
import type { AudioWorkerRequest, AudioWorkerResponse } from './analysis-types';

const mocks = vi.hoisted(() => ({ get: vi.fn(), withSpectrum: vi.fn() }));
vi.mock('./local-audio', () => ({ LocalAudioSource: { open: async () => ({ metadata: {} }) } }));
vi.mock('./segment-store', () => ({ AudioSegmentStore: class {
  get = mocks.get;
  withSpectrum = mocks.withSpectrum;
  cacheBytes = 100;
  decodedSegments = 1;
} }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); vi.resetModules(); });

it('sends only missing tiles and upgrades retained waveforms when spectrum is requested', async () => {
  vi.useFakeTimers();
  const messages: AudioWorkerResponse[] = [];
  const scope = { onmessage: null as null | ((event: { data: AudioWorkerRequest }) => void),
    postMessage: (message: AudioWorkerResponse) => messages.push(message) };
  vi.stubGlobal('self', scope);
  const tile = { start: 2, end: 4, peaks: new Float32Array([0, 1]) };
  mocks.get.mockResolvedValue({ tile });
  mocks.withSpectrum.mockResolvedValue({ tile: { ...tile, spectrum: { energy: new Uint8Array([1]) } } });
  await import('./audio.worker');
  scope.onmessage!({ data: { type: 'open', file: {} as File } });
  await vi.runAllTimersAsync(); messages.length = 0;
  scope.onmessage!({ data: { type: 'view', id: 1, start: 0, end: 4, mode: 'waveform', retained: [{ start: 0, spectrum: false }] } });
  await vi.runAllTimersAsync();
  expect(mocks.get).toHaveBeenCalledTimes(1);
  expect(messages.filter(message => message.type === 'tile')).toHaveLength(1);
  expect(messages.at(-1)?.type).toBe('complete');
  messages.length = 0;
  scope.onmessage!({ data: { type: 'view', id: 2, start: 0, end: 4, mode: 'spectrum',
    retained: [{ start: 0, spectrum: true }, { start: 2, spectrum: false }] } });
  await vi.runAllTimersAsync();
  expect(mocks.withSpectrum).toHaveBeenCalledTimes(1);
  expect(messages.filter(message => message.type === 'tile')).toHaveLength(1);
  messages.length = 0;
  scope.onmessage!({ data: { type: 'view', id: 3, start: 0, end: 4, mode: 'spectrum',
    retained: [{ start: 0, spectrum: true }, { start: 2, spectrum: true }] } });
  await vi.runAllTimersAsync();
  expect(messages.map(message => message.type)).toEqual(['complete']);
  expect(mocks.withSpectrum).toHaveBeenCalledTimes(1);
});
