import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditionRange, watchPlaybackRange } from './playback';

describe('audition ranges in milliseconds', () => {
  it.each([
    ['selection', 1000, 3000], ['before-start', 500, 1000], ['after-end', 3000, 3500],
    ['first-500', 1000, 1500], ['last-500', 2500, 3000],
  ] as const)('computes %s separately', (mode, start, end) => {
    expect(auditionRange(mode, 1000, 3000, 5000)).toEqual({ start, end });
  });

  it('keeps first/last auditions inside a selection shorter than 500ms', () => {
    for (const mode of ['first-500', 'last-500'] as const) {
      expect(auditionRange(mode, 1000, 1200, 5000)).toEqual({ start: 1000, end: 1200 });
    }
  });

  it('clips every range to the video without extending empty intersections', () => {
    expect(auditionRange('before-start', 100, 4900, 5000)).toEqual({ start: 0, end: 100 });
    expect(auditionRange('after-end', 100, 4900, 5000)).toEqual({ start: 4900, end: 5000 });
    expect(auditionRange('before-start', 0, 1000, 5000)).toBeNull();
    expect(auditionRange('after-end', 1000, 5000, 5000)).toBeNull();
    expect(auditionRange('selection', 4900, 5500, 5000)).toEqual({ start: 4900, end: 5000 });
    expect(auditionRange('first-500', 4900, 5500, 5000)).toEqual({ start: 4900, end: 5000 });
    expect(auditionRange('last-500', 4500, 5200, 5000)).toEqual({ start: 4700, end: 5000 });
    expect(auditionRange('selection', 5100, 5500, 5000)).toBeNull();
    expect(auditionRange('last-500', 5100, 5500, 5000)).toBeNull();
    expect(auditionRange('selection', 4900, 5500, 5000.5)).toEqual({ start: 4900, end: 5000.5 });
  });

  it('uses existing timing validation and requires a playable duration', () => {
    for (const [start, end] of [[1000, 1000], [3000, 1000], [-10, 1000], [1, 1000]]) {
      expect(() => auditionRange('selection', start, end, 5000)).toThrow();
    }
    for (const duration of [0, -1, NaN, Infinity]) {
      expect(() => auditionRange('selection', 1000, 3000, duration)).toThrow();
    }
  });
});

describe('shared range playback observer', () => {
  let frames: Map<number, FrameRequestCallback>;
  let frameId: number;
  let video: HTMLVideoElement;
  const finish = vi.fn();
  const error = vi.fn();

  function tick() {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
  }

  beforeEach(() => {
    frames = new Map(); frameId = 0;
    finish.mockClear(); error.mockClear();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback); return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    video = Object.assign(new EventTarget(), {
      currentTime: 1, paused: false,
      pause: vi.fn(function (this: { paused: boolean }) { this.paused = true; }),
      play: vi.fn().mockResolvedValue(undefined),
    }) as unknown as HTMLVideoElement;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('plays through the range once, then pauses at its end and releases the observer', () => {
    const cleanup = watchPlaybackRange(video, { start: 1000, end: 1500, repeat: false }, finish, error);
    video.currentTime = 1.49; tick();
    expect(video.pause).not.toHaveBeenCalled();
    video.currentTime = 1.52; tick();
    expect(video.currentTime).toBe(1.5);
    expect(video.pause).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
    expect(video.play).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    video.dispatchEvent(new Event('ended'));
    expect(finish).toHaveBeenCalledOnce();
    cleanup();
  });

  it('retains looping and restarts at the beginning on media end', () => {
    const cleanup = watchPlaybackRange(video, { start: 1000, end: 1500, repeat: true }, finish, error);
    video.currentTime = 1.52; tick();
    expect(video.currentTime).toBe(1);
    video.currentTime = 0.5; tick();
    expect(video.currentTime).toBe(1);
    video.currentTime = 5;
    video.dispatchEvent(new Event('ended'));
    expect(video.currentTime).toBe(1);
    expect(video.play).toHaveBeenCalledOnce();
    expect(video.pause).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    cleanup();
  });

  it('finishes a one-shot at media end without restarting playback', () => {
    const cleanup = watchPlaybackRange(video, { start: 1000, end: 5000, repeat: false }, finish, error);
    video.dispatchEvent(new Event('ended'));
    expect(finish).toHaveBeenCalledOnce();
    expect(video.play).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    cleanup();
  });

  it('cancels stale listeners when a different range or mode is selected', () => {
    const cleanup = watchPlaybackRange(video, { start: 1000, end: 1500, repeat: true }, finish, error);
    cleanup();
    watchPlaybackRange(video, { start: 2000, end: 2500, repeat: false }, finish, error)();
    video.currentTime = 3; tick();
    video.dispatchEvent(new Event('ended'));
    expect(video.currentTime).toBe(3);
    expect(video.pause).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('reports a failed loop restart and ignores failures after cancellation', async () => {
    const failure = new Error('play failed');
    vi.mocked(video.play).mockRejectedValue(failure);
    const cleanup = watchPlaybackRange(video, { start: 1000, end: 1500, repeat: true }, finish, error);
    video.dispatchEvent(new Event('ended'));
    await Promise.resolve();
    expect(error).toHaveBeenCalledWith(failure);
    expect(finish).toHaveBeenCalledOnce();
    cleanup();
    error.mockClear(); finish.mockClear();
    const cancel = watchPlaybackRange(video, { start: 1000, end: 1500, repeat: true }, finish, error);
    video.dispatchEvent(new Event('ended')); cancel();
    await Promise.resolve();
    expect(error).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });
});
