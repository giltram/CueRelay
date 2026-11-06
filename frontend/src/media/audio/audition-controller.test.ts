import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioAuditionController, scheduleAuditionChunks } from './audition-controller';
import { auditionWindowSeconds, AUDITION_WINDOW_BYTES } from './audition-protocol';
import type { AuditionReader } from './audition-reader';
import type { AudioMetadata, PcmChunk } from './local-audio';

const metadata: AudioMetadata = { sampleRate: 48000, channels: 2, codec: 'mp4a.40.2', firstTimestamp: 0, endTimestamp: 36000 };
function audioClock() {
  const nodes: any[] = [];
  const gain = { cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn() };
  const output = { gain, connect: vi.fn(), disconnect: vi.fn() };
  const context = {
    currentTime: 10, state: 'running', destination: {},
    resume: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    createGain: () => output,
    createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => {
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return { getChannelData: (i: number) => data[i], length, sampleRate, data };
    }),
    createBufferSource: () => {
      const node = { buffer: null, onended: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() };
      nodes.push(node); return node;
    },
  };
  return { context: context as unknown as AudioContext, nodes, gain, output };
}
function reader(): AuditionReader {
  return { open: vi.fn().mockResolvedValue(metadata), dispose: vi.fn(),
    read: vi.fn(async (start, end) => [{ timestamp: start, sampleRate: 48000,
      channels: [new Float32Array(Math.round((end - start) * 48000)), new Float32Array(Math.round((end - start) * 48000))] }]) };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('sample-bounded scheduling', () => {
  it('excludes samples before in and at/after out; preserves channels and PTS gaps', () => {
    const { context, nodes } = audioClock();
    const chunks: PcmChunk[] = [
      { timestamp: 2.5, sampleRate: 1000, channels: [Float32Array.of(9, 1, 2, 3, 9), Float32Array.of(-9, -1, -2, -3, -9)] },
      { timestamp: 2.508, sampleRate: 1000, channels: [Float32Array.of(4, 9), Float32Array.of(-4, -9)] },
    ];
    scheduleAuditionChunks(context, chunks, { start: 2501, end: 2509 }, 20, new Set());
    expect([...nodes[0].buffer.data[0]]).toEqual([1, 2, 3, 9]);
    expect([...nodes[0].buffer.data[1]]).toEqual([-1, -2, -3, -9]);
    expect([...nodes[1].buffer.data[0]]).toEqual([4]);
    expect(nodes[0].start).toHaveBeenCalledWith(20);
    expect(nodes[1].start.mock.calls[0][0]).toBeCloseTo(20.007);
    expect(nodes[1].stop.mock.calls[0][0]).toBeCloseTo(20.008);
  });
  it('clamps the rendering stop to a fractional sample boundary without early compensation', () => {
    const { context, nodes } = audioClock();
    scheduleAuditionChunks(context, [{ timestamp: 0, sampleRate: 1000, channels: [Float32Array.of(1, 2, 3, 99)] }],
      { start: .5, end: 2.5 }, 20, new Set());
    expect([...nodes[0].buffer.data[0]]).toEqual([2, 3]);
    expect(nodes[0].start.mock.calls[0][0]).toBeCloseTo(20.0005);
    expect(nodes[0].stop.mock.calls[0][0]).toBeCloseTo(20.002);
  });
  it('shrinks windows for high channel/rate tracks within the same budget', () => {
    for (const sampleRate of [48000, 192000]) for (const channels of [2, 8, 32]) {
      const span = auditionWindowSeconds({ ...metadata, sampleRate, channels });
      expect(span).toBeLessThanOrEqual(2);
      expect(Math.ceil(span * sampleRate) * channels * 4).toBeLessThanOrEqual(AUDITION_WINDOW_BYTES);
    }
  });
});

describe('independent audition session', () => {
  it('shortens and re-extends a live selection on the same clock without discarding decoded audio', async () => {
    const { context, nodes, gain } = audioClock(); const source = reader();
    const controller = new AudioAuditionController(() => source, vi.fn(), () => context);
    await controller.start({ start: 1000, end: 4000 }, true);
    const originalNodes = [...nodes];
    Object.assign(context, { currentTime: 10.55 });
    expect(controller.updateEnd(2000)).toBe(true);
    expect(gain.setValueAtTime).toHaveBeenLastCalledWith(0, 11.05);
    expect(controller.getPosition()).toBeCloseTo(1500);
    controller.updateEnd(3500);
    expect(gain.setValueAtTime).toHaveBeenLastCalledWith(0, 12.55);
    expect(nodes).toEqual(originalNodes);
    expect(source.read).toHaveBeenCalledTimes(2);
    expect(source.dispose).not.toHaveBeenCalled();
    Object.assign(context, { currentTime: 12.56 }); vi.advanceTimersByTime(25);
    expect(controller.state).toEqual({ phase: 'finished', position: 3500, message: '' });
    controller.dispose();
  });
  it('extends beyond the original decoded end by fetching only the continuation', async () => {
    const { context, gain } = audioClock(); const source = reader();
    const controller = new AudioAuditionController(() => source, vi.fn(), () => context);
    await controller.start({ start: 1000, end: 1800 }, true);
    Object.assign(context, { currentTime: 10.25 });
    controller.updateEnd(2800); await flush();
    expect(source.read).toHaveBeenLastCalledWith(1.8, 2.8);
    expect(controller.getPosition()).toBeCloseTo(1200);
    expect(gain.setValueAtTime.mock.lastCall![1]).toBeCloseTo(11.85);
    Object.assign(context, { currentTime: 10.95 }); vi.advanceTimersByTime(25);
    expect(controller.state.phase).toBe('playing');
    Object.assign(context, { currentTime: 11.86 }); vi.advanceTimersByTime(25);
    expect(controller.state.position).toBe(2800);
    controller.dispose();
  });
  it('immediately finishes when the new out point is behind the playhead', async () => {
    const { context, nodes, output } = audioClock(); const source = reader();
    const controller = new AudioAuditionController(() => source, vi.fn(), () => context);
    await controller.start({ start: 1000, end: 4000 }, true);
    Object.assign(context, { currentTime: 11.05 });
    controller.updateEnd(1500);
    expect(controller.state).toEqual({ phase: 'finished', position: 1500, message: '' });
    expect(nodes.every(node => node.buffer === null)).toBe(true);
    expect(output.disconnect).toHaveBeenCalledOnce();
    expect(controller.updateEnd(5000)).toBe(false);
    controller.dispose();
  });
  it('uses end edits made during preparation, including an in-flight read', async () => {
    const { context, gain } = audioClock(); const source = reader();
    let complete!: (chunks: PcmChunk[]) => void;
    vi.mocked(source.read).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const controller = new AudioAuditionController(() => source, vi.fn(), () => context);
    const preparing = controller.start({ start: 1000, end: 1800 }, true); await flush();
    controller.updateEnd(2500); complete([]); await preparing;
    expect(source.read).toHaveBeenLastCalledWith(1.8, 2.5);
    expect(gain.setValueAtTime).toHaveBeenLastCalledWith(0, 11.55);
    expect(controller.state.phase).toBe('playing'); controller.dispose();
  });
  it('does not revive an elapsed range or change fixed auditions', async () => {
    const { context } = audioClock(); const source = reader();
    const controller = new AudioAuditionController(() => source, vi.fn(), () => context);
    await controller.start({ start: 0, end: 500 });
    expect(controller.updateEnd(900)).toBe(false);
    await controller.start({ start: 0, end: 500 }, true);
    Object.assign(context, { currentTime: 10.6 });
    controller.updateEnd(1500);
    expect(controller.state).toEqual({ phase: 'finished', position: 500, message: '' });
    controller.dispose();
  });
  it('fully prepares a short selection and ends by audio clock, with no boundary callback required', async () => {
    const { context, nodes } = audioClock(); const source = reader();
    const controller = new AudioAuditionController(() => source, vi.fn(), () => context);
    await controller.start({ start: 1234, end: 1294 });
    expect(source.read).toHaveBeenCalledExactlyOnceWith(1.234, 1.294);
    expect(context.resume).toHaveBeenCalledOnce();
    const stop = nodes[0].stop.mock.calls[0][0];
    expect(stop).toBeCloseTo(10.11);
    // No JS tick is delivered until 80ms AFTER out; native stop was already scheduled.
    Object.assign(context, { currentTime: 10.19 });
    expect(nodes[0].stop.mock.calls[0][0]).toBe(stop);
    vi.advanceTimersByTime(25);
    expect(controller.state).toEqual({ phase: 'finished', position: 1294, message: '' });
    expect(source.dispose).toHaveBeenCalledOnce();
    controller.dispose();
  });
  it('streams long ranges across windows with only two scheduled plus one pending read', async () => {
    const { context, nodes } = audioClock(); const source = reader();
    const controller = new AudioAuditionController(() => source, vi.fn(), () => context);
    await controller.start({ start: 1900, end: 31900 });
    expect(source.read).toHaveBeenCalledTimes(2);
    expect(controller.state.phase).toBe('playing');
    for (let elapsed = 2; elapsed < 30; elapsed += 2) {
      Object.assign(context, { currentTime: 10.05 + elapsed + .001 });
      vi.advanceTimersByTime(25); await flush();
      expect(controller.state.phase).toBe('playing');
      expect(nodes.filter(n => n.buffer !== null).length).toBeLessThanOrEqual(2);
    }
    expect(source.read).toHaveBeenCalledTimes(15);
    expect(source.read).toHaveBeenLastCalledWith(29.9, 31.9);
    Object.assign(context, { currentTime: 40.06 }); vi.advanceTimersByTime(25);
    expect(controller.state.position).toBe(31900); expect(controller.state.phase).toBe('finished');
    controller.dispose();
  });
  it('retains silence gaps and completes ranges without any PCM', async () => {
    const { context, nodes } = audioClock(); const source = reader();
    vi.mocked(source.read).mockResolvedValue([]);
    const controller = new AudioAuditionController(() => source, vi.fn(), () => context);
    await controller.start({ start: 0, end: 500 });
    expect(nodes).toEqual([]);
    Object.assign(context, { currentTime: 10.6 }); vi.advanceTimersByTime(25);
    expect(controller.state).toEqual({ phase: 'finished', position: 500, message: '' });
    controller.dispose();
  });
  it('retrigger stops/disconnects old nodes and cancels stale preparation', async () => {
    const { context, nodes } = audioClock(); const sources = [reader(), reader(), reader()]; let index = 0;
    const controller = new AudioAuditionController(() => sources[index++], vi.fn(), () => context);
    await controller.start({ start: 0, end: 500 });
    const old = nodes[0];
    await controller.start({ start: 1000, end: 1500 });
    expect(old.stop).toHaveBeenLastCalledWith(); expect(old.disconnect).toHaveBeenCalled(); expect(old.buffer).toBeNull();
    expect(sources[0].dispose).toHaveBeenCalledOnce();
    let finish!: (chunks: PcmChunk[]) => void;
    vi.mocked(sources[2].read).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const preparing = controller.start({ start: 2000, end: 2500 }); await flush();
    controller.stop(); finish([{ timestamp: 2, sampleRate: 1000, channels: [Float32Array.of(99)] }]);
    await preparing;
    expect(controller.state.phase).toBe('idle'); expect(nodes).toHaveLength(2);
    controller.dispose(); expect(context.close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it('reports starvation even when JS resumes after the requested out point', async () => {
    const { context } = audioClock(); const source = reader();
    const controller = new AudioAuditionController(() => source, vi.fn(), () => context);
    await controller.start({ start: 0, end: 15000 });
    expect(source.read).toHaveBeenCalledTimes(2);
    // Only the first four seconds were scheduled; a late tick cannot call the whole range finished.
    Object.assign(context, { currentTime: 30 }); vi.advanceTimersByTime(25);
    expect(controller.state.phase).toBe('error'); expect(controller.state.message).toContain('预取');
    expect(source.dispose).toHaveBeenCalledOnce(); controller.dispose();
  });
  it('reports decode/open/no-audio failures without an alternate player', async () => {
    const { context, nodes } = audioClock(); const source = reader();
    vi.mocked(source.open).mockRejectedValue(Error('视频没有音轨'));
    const controller = new AudioAuditionController(() => source, vi.fn(), () => context);
    await controller.start({ start: 0, end: 500 });
    expect(controller.state.phase).toBe('error'); expect(controller.state.message).toContain('没有音轨');
    expect(source.dispose).toHaveBeenCalledOnce(); expect(nodes).toEqual([]); controller.dispose();
  });
  it('stops safely on prefetch underrun and ignores a stale rejected read', async () => {
    const { context } = audioClock(); const source = reader();
    const controller = new AudioAuditionController(() => source, vi.fn(), () => context);
    await controller.start({ start: 0, end: 20000 });
    let fail!: (reason: Error) => void;
    vi.mocked(source.read).mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    Object.assign(context, { currentTime: 12.1 }); vi.advanceTimersByTime(25); await flush();
    controller.stop(); fail(Error('stale')); await flush(); expect(controller.state.phase).toBe('idle');
    vi.mocked(source.read).mockResolvedValue([]);
    Object.assign(context, { currentTime: 20 }); await controller.start({ start: 0, end: 20000 });
    Object.assign(context, { currentTime: 25 }); vi.advanceTimersByTime(25); await flush();
    expect(controller.state.phase).toBe('error'); expect(controller.state.message).toContain('预取'); controller.dispose();
  });
});
