import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkerAuditionReader } from './audition-reader';

let worker: any;
beforeEach(() => {
  vi.stubGlobal('Worker', class {
    onmessage: any; onerror: any; onmessageerror: any;
    postMessage = vi.fn(); terminate = vi.fn();
    constructor() { worker = this; }
  });
});
afterEach(() => vi.unstubAllGlobals());

it('uses its own worker, serializes open/read and transfers timestamped PCM unchanged', async () => {
  const reader = new WorkerAuditionReader({ name: 'local.mp4' } as File);
  const opening = reader.open();
  expect(worker.postMessage).toHaveBeenCalledWith({ type: 'open', file: { name: 'local.mp4' } });
  const metadata = { sampleRate: 48000, channels: 2 };
  worker.onmessage({ data: { type: 'ready', metadata } });
  expect(await opening).toBe(metadata);
  const chunks = [{ timestamp: 2.5, sampleRate: 48000, channels: [Float32Array.of(1), Float32Array.of(-1)] }];
  const reading = reader.read(2, 4);
  worker.onmessage({ data: { type: 'pcm', chunks } });
  expect(await reading).toBe(chunks); reader.dispose(); expect(worker.terminate).toHaveBeenCalledOnce();
});
it('rejects pending preparation on cancellation and rejects requests after disposal', async () => {
  const reader = new WorkerAuditionReader({} as File);
  const opening = reader.open(); reader.dispose();
  await expect(opening).rejects.toMatchObject({ name: 'AbortError' });
  await expect(reader.read(0, 1)).rejects.toMatchObject({ name: 'AbortError' });
  expect(worker.onmessage).toBeNull();
});
it('reports worker failure even if it happens between requests', async () => {
  const reader = new WorkerAuditionReader({} as File);
  worker.onerror();
  await expect(reader.read(0, 1)).rejects.toThrow('Worker 中断'); reader.dispose();
});
it('reports worker message failures and explicit decode errors', async () => {
  const reader = new WorkerAuditionReader({} as File);
  const reading = reader.read(0, 1); worker.onmessageerror();
  await expect(reading).rejects.toThrow('Worker 中断'); reader.dispose();
  const next = new WorkerAuditionReader({} as File);
  const opening = next.open(); worker.onmessage({ data: { type: 'error', message: '没有音轨' } });
  await expect(opening).rejects.toThrow('没有音轨'); next.dispose();
});
