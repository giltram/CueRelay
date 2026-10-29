import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type JASSUB from 'jassub';
import { createJassubRenderer } from './jassub-renderer';
import type { PreviewRenderer } from './preview-session';

const engine = vi.hoisted(() => ({ current: undefined as unknown as JASSUB, render: vi.fn() }));
vi.mock('jassub', () => ({ default: class {
  _video?: HTMLVideoElement;
  _worker = new EventTarget();
  ready = Promise.resolve();
  renderer = { setTrack: vi.fn().mockResolvedValue(undefined) };
  constructor() { engine.current = this as unknown as JASSUB; }
  async setVideo(video: HTMLVideoElement) { this._video = video; }
  manualRender(data: unknown, repaint: boolean) { engine.render(data, repaint); return Promise.resolve(); }
  async resize() {}
  async destroy() {}
} }));

let preview: PreviewRenderer;
let video: HTMLVideoElement;
const frame = (mediaTime: number) => ({ mediaTime, width: 640, height: 480, expectedDisplayTime: 100 });

beforeEach(async () => {
  engine.render.mockClear();
  const canvas = { className: '', style: {}, setAttribute: vi.fn(), transferControlToOffscreen: vi.fn(), remove: vi.fn() };
  vi.stubGlobal('document', Object.assign(new EventTarget(), { createElement: () => canvas }));
  vi.stubGlobal('Worker', vi.fn());
  vi.stubGlobal('OffscreenCanvas', vi.fn());
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }));
  video = Object.assign(new EventTarget(), {
    currentTime: 1.87, paused: true, seeking: false, videoWidth: 640, videoHeight: 480,
    insertAdjacentElement: vi.fn(),
  }) as unknown as HTMLVideoElement;
  preview = createJassubRenderer(video, 'track', vi.fn());
  await preview.ready;
  engine.render.mockClear();
});
afterEach(() => { preview?.destroy(); vi.unstubAllGlobals(); });

describe('subtitle render clock', () => {
  it('keeps the exact paused position when a later callback contains an earlier frame timestamp', async () => {
    video.dispatchEvent(new Event('pause'));
    await engine.current.manualRender(frame(1.84));
    expect(engine.render.mock.calls.map(([data]) => data.mediaTime)).toEqual([1.87, 1.87]);
    expect(engine.render).toHaveBeenLastCalledWith(frame(1.87), false);
  });

  it('uses the current seek position across both cue boundaries, including a playing seek', async () => {
    Object.assign(video, { currentTime: 1.23, paused: false, seeking: true });
    await engine.current.manualRender(frame(3.4));
    expect(engine.render).toHaveBeenLastCalledWith(frame(1.23), false);
    Object.assign(video, { paused: true, seeking: false });
    video.dispatchEvent(new Event('seeked'));
    await engine.current.manualRender(frame(1.2));
    expect(engine.render).toHaveBeenLastCalledWith(frame(1.23), false);
    expect(engine.render.mock.calls.map(([data]) => data.mediaTime)).toEqual([1.23, 1.23, 1.23]);
  });

  it('resumes following frame timestamps during normal playback and preserves forced repaints', async () => {
    Object.assign(video, { currentTime: 1.864, paused: false });
    const metadata = frame(1.88);
    await engine.current.manualRender(metadata);
    expect(engine.render).toHaveBeenLastCalledWith(metadata, false);
    expect(engine.render.mock.calls.at(-1)?.[0]).toBe(metadata);
    Object.assign(video, { paused: true });
    await engine.current.manualRender(metadata, true);
    expect(engine.render).toHaveBeenLastCalledWith(frame(1.864), true);
  });
});
