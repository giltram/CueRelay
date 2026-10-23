import { LocalAudioSource } from './local-audio';
import { AUDIO_SEGMENT_SECONDS, type AudioWorkerRequest, type AudioWorkerResponse } from './analysis-types';
import { AudioSegmentStore } from './segment-store';

// One Worker per File. Terminating it on replacement releases the entire session and its caches.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<AudioWorkerRequest>) => void) | null;
  postMessage: (message: AudioWorkerResponse) => void;
};
let store: AudioSegmentStore | null = null;
let pending: Extract<AudioWorkerRequest, { type: 'view' }> | null = null;
let active: AbortController | null = null;
let running = false;

async function drain() {
  if (running || !store) return;
  running = true;
  try {
    while (pending) {
      const request = pending; pending = null;
      const controller = active = new AbortController();
      try {
        if (!Number.isFinite(request.start) || !Number.isFinite(request.end) || request.start < 0 ||
            request.end <= request.start || request.end - request.start > 60.001) throw Error('音频视窗须在 0–60 秒范围内');
        const first = Math.floor(request.start / AUDIO_SEGMENT_SECONDS);
        const last = Math.ceil(request.end / AUDIO_SEGMENT_SECONDS);
        for (let index = first; index < last; index++) {
          const entry = request.mode === 'spectrum' ? await store.withSpectrum(index, controller.signal) : await store.get(index, controller.signal);
          controller.signal.throwIfAborted();
          scope.postMessage({ type: 'tile', id: request.id, tile: entry.tile });
          // Let newer viewport / cancellation messages preempt cache hits and CPU work.
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        controller.signal.throwIfAborted();
        scope.postMessage({ type: 'complete', id: request.id, cacheBytes: store.cacheBytes, decodedSegments: store.decodedSegments });
      } catch (error) {
        if (!controller.signal.aborted) scope.postMessage({ type: 'error', id: request.id, message: (error as Error).message });
      }
    }
  } finally { running = false; }
}

scope.onmessage = event => {
  const message = event.data;
  if (message.type === 'open') {
    void LocalAudioSource.open(message.file).then(source => {
      store = new AudioSegmentStore(source);
      scope.postMessage({ type: 'ready', metadata: source.metadata });
      void drain();
    }).catch(error => scope.postMessage({ type: 'error', message: (error as Error).message }));
  } else {
    active?.abort(); pending = message;
    void drain();
  }
};
