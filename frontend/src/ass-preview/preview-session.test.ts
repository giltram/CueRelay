import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewSession } from './preview-session';
import type { AssDocument } from '../contracts/subtitles';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const document = (text: string): AssDocument => ({ schema_version: 2, script: { play_res_x: null, play_res_y: null, scaled_border_and_shadow: null }, source: text, styles: [], cues: [] });
function fixture() {
  const renderer = { ready: Promise.resolve(), setTrack: vi.fn(async (_text: string) => {}), setVisible: vi.fn(), destroy: vi.fn() };
  const serialize = vi.fn(async (doc: AssDocument, _signal: AbortSignal) => doc.source);
  const createRenderer = vi.fn(() => renderer);
  const onStatus = vi.fn();
  return { renderer, serialize, createRenderer, onStatus };
}
const tick = () => vi.advanceTimersByTimeAsync(120);
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('preview snapshots', () => {
  it('coalesces typing, reuses the renderer, and skips identical tracks', async () => {
    const deps = fixture(), session = new PreviewSession(deps);
    session.update(document('a')); session.update(document('ab')); session.update(document('abc'));
    await tick();
    expect(deps.serialize).toHaveBeenCalledTimes(1);
    session.update(document('edited')); await tick();
    session.update(document('edited')); await tick();
    expect(deps.createRenderer).toHaveBeenCalledTimes(1);
    expect(deps.renderer.setTrack.mock.calls.map(call => call[0])).toEqual(['abc', 'edited']);
    session.dispose();
  });

  it('discards a stale response even when the converter ignores abort', async () => {
    const deps = fixture(), old = deferred<string>();
    deps.serialize.mockImplementationOnce(() => old.promise);
    const session = new PreviewSession(deps);
    session.update(document('old')); await tick();
    const signal = deps.serialize.mock.calls[0][1];
    session.update(document('new')); await tick();
    expect(signal.aborted).toBe(true);
    old.resolve('old'); await tick();
    expect(deps.renderer.setTrack.mock.calls.map(call => call[0])).toEqual(['new']);
    session.dispose();
  });

  it('serializes worker updates and drains only the latest queued track', async () => {
    const deps = fixture(), inFlight = deferred<void>();
    deps.renderer.setTrack.mockImplementationOnce(() => inFlight.promise);
    const session = new PreviewSession(deps);
    session.update(document('first')); await tick();
    session.update(document('middle')); await tick();
    session.update(document('last')); await tick();
    expect(deps.renderer.setTrack).toHaveBeenCalledTimes(1);
    inFlight.resolve(); await tick();
    expect(deps.renderer.setTrack.mock.calls.map(call => call[0])).toEqual(['first', 'last']);
    expect(deps.onStatus.mock.calls.filter(call => call[0].phase === 'ready')).toHaveLength(1);
    session.dispose();
  });

  it('uses the newest snapshot after slow initialization and disposes pending work', async () => {
    const deps = fixture(), ready = deferred<void>();
    deps.renderer.ready = ready.promise;
    const session = new PreviewSession(deps);
    session.update(document('first')); await tick();
    session.update(document('last')); await tick();
    ready.resolve(); await tick();
    expect(deps.renderer.setTrack.mock.calls.map(call => call[0])).toEqual(['last']);
    session.update(document('unmounted')); session.dispose(); session.dispose(); await tick();
    expect(deps.renderer.destroy).toHaveBeenCalledTimes(1);
    expect(deps.serialize).toHaveBeenCalledTimes(2);
  });

  it('hides an invalid draft and recovers on a valid edit without recreating', async () => {
    const deps = fixture(), session = new PreviewSession(deps);
    session.update(document('valid')); await tick();
    deps.serialize.mockRejectedValueOnce(new Error('unsupported tag'));
    session.update(document('partial')); await tick();
    expect(deps.renderer.setVisible).toHaveBeenLastCalledWith(false);
    expect(deps.onStatus).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'error' }));
    session.setVisible(false); session.update(document('valid again')); await tick();
    expect(deps.createRenderer).toHaveBeenCalledTimes(1);
    expect(deps.renderer.setVisible).toHaveBeenLastCalledWith(false);
    session.setVisible(true);
    expect(deps.renderer.setVisible).toHaveBeenLastCalledWith(true);
    session.dispose();
  });

  it('cleans up a renderer still loading without letting it publish after unmount', async () => {
    const deps = fixture(), ready = deferred<void>();
    deps.renderer.ready = ready.promise;
    const session = new PreviewSession(deps);
    session.update(document('first')); await tick();
    session.dispose(); ready.resolve(); await tick();
    expect(deps.renderer.destroy).toHaveBeenCalledTimes(1);
    expect(deps.renderer.setTrack).not.toHaveBeenCalled();
    expect(deps.onStatus.mock.calls.filter(call => call[0].phase === 'ready')).toHaveLength(0);
  });
});
