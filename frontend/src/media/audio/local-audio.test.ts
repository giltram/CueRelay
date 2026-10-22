import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalAudioSource, MAX_WINDOW_PCM_BYTES } from './local-audio';

const fake = vi.hoisted(() => ({
  readable: true, track: true, decodable: true, disposed: false,
  rate: 48000, channels: 2, samples: [] as any[], inputs: [] as any[],
  iterate: null as null | (() => AsyncGenerator<any, void, unknown>),
}));
vi.mock('mediabunny', () => ({
  MP4: {},
  BlobSource: class { on() {} },
  Input: class {
    disposed = false;
    constructor() { fake.inputs.push(this); }
    async canRead() { return fake.readable; }
    async getPrimaryAudioTrack() {
      return fake.track ? {
        getDecoderConfig: async () => ({ codec: 'mp4a.40.2', sampleRate: fake.rate, numberOfChannels: fake.channels }),
        canDecode: async () => fake.decodable,
        getFirstTimestamp: async () => 2.5,
        getDurationFromMetadata: async () => 300,
      } : null;
    }
    dispose() { this.disposed = true; }
  },
  AudioSampleSink: class {
    samples() {
      return fake.iterate ? fake.iterate() : (async function* () { yield* fake.samples; })();
    }
  },
}));

function sample(timestamp: number, frames = 480) {
  return {
    timestamp, numberOfFrames: frames, sampleRate: 48000, numberOfChannels: 2,
    copyTo: vi.fn((data: Float32Array, options: { planeIndex: number }) => data.fill(options.planeIndex ? -0.25 : 0.25)),
    close: vi.fn(),
  };
}

beforeEach(() => {
  Object.assign(fake, { readable: true, track: true, decodable: true, rate: 48000, channels: 2, samples: [], inputs: [], iterate: null });
  vi.stubGlobal('AudioDecoder', { isConfigSupported: async () => ({ supported: true }) });
});
afterEach(() => vi.unstubAllGlobals());

describe('bounded local audio extraction', () => {
  it('keeps the audio offset and crops PCM to requested presentation time', async () => {
    const source = await LocalAudioSource.open(new Blob());
    expect(source.metadata.firstTimestamp).toBe(2.5);
    const block = sample(2.5);
    fake.samples = [block];
    const received: any[] = [];
    const result = await source.readRange(2.5025, 2.5075, chunk => received.push(chunk));
    expect(result).toEqual({ pcmBytes: 240 * 2 * 4, chunks: 1 });
    expect(received[0].timestamp).toBeCloseTo(2.5025);
    expect(received[0].channels.map((c: Float32Array) => c.length)).toEqual([240, 240]);
    expect(received[0].channels[1][0]).toBe(-0.25);
    expect(block.close).toHaveBeenCalledOnce();
    source.dispose();
  });

  it('returns no fabricated PCM for a gap before the audio track', async () => {
    const source = await LocalAudioSource.open(new Blob());
    fake.samples = [sample(2.5)];
    const consume = vi.fn();
    expect(await source.readRange(0, 1, consume)).toEqual({ pcmBytes: 0, chunks: 0 });
    expect(consume).not.toHaveBeenCalled();
    source.dispose();
  });

  it('clips negative priming timestamps without shifting the rest of the track', async () => {
    const source = await LocalAudioSource.open(new Blob());
    const priming = sample(-0.005);
    fake.samples = [priming];
    const received: any[] = [];
    await source.readRange(0, 1, chunk => received.push(chunk));
    expect(received[0].timestamp).toBe(0);
    expect(received[0].channels[0].length).toBe(240);
    expect(priming.close).toHaveBeenCalledOnce();
    source.dispose();
  });

  it.each([[NaN, 1], [-1, 1], [1, 1], [2, 1], [0, 11], [0, Infinity]])('rejects invalid or unbounded ranges %s–%s', async (start, end) => {
    const source = await LocalAudioSource.open(new Blob());
    await expect(source.readRange(start, end, vi.fn())).rejects.toMatchObject({ code: 'range' });
    source.dispose();
  });

  it('checks the PCM budget before decoding high channel/rate audio', async () => {
    fake.rate = 192000; fake.channels = 8;
    expect(10 * fake.rate * fake.channels * 4).toBeGreaterThan(MAX_WINDOW_PCM_BYTES);
    const source = await LocalAudioSource.open(new Blob());
    await expect(source.readRange(0, 10, vi.fn())).rejects.toMatchObject({ code: 'range' });
    source.dispose();
  });

  it.each(['unreadable', 'no-audio', 'unsupported'])('releases input when opening fails: %s', async code => {
    if (code === 'unreadable') fake.readable = false;
    if (code === 'no-audio') fake.track = false;
    if (code === 'unsupported') fake.decodable = false;
    await expect(LocalAudioSource.open(new Blob())).rejects.toMatchObject({ code });
    expect(fake.inputs[0].disposed).toBe(true);
  });

  it('handles browsers without AudioDecoder', async () => {
    vi.stubGlobal('AudioDecoder', undefined);
    await expect(LocalAudioSource.open(new Blob())).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('checks the actual native decoder configuration', async () => {
    const supported = vi.fn(async () => ({ supported: false }));
    vi.stubGlobal('AudioDecoder', { isConfigSupported: supported });
    await expect(LocalAudioSource.open(new Blob())).rejects.toMatchObject({ code: 'unsupported' });
    expect(supported).toHaveBeenCalledWith({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2 });
  });

  it('disposes an input canceled during opening', async () => {
    const controller = new AbortController();
    const opening = LocalAudioSource.open(new Blob(), controller.signal);
    controller.abort();
    await expect(opening).rejects.toMatchObject({ name: 'AbortError' });
    expect(fake.inputs[0].disposed).toBe(true);
  });

  it('closes the sample and iterator when PCM consumption fails', async () => {
    const source = await LocalAudioSource.open(new Blob());
    const block = sample(0);
    const finished = vi.fn();
    fake.iterate = async function* () { try { yield block; } finally { finished(); } };
    await expect(source.readRange(0, 1, () => { throw Error('consumer failed'); })).rejects.toMatchObject({ code: 'decode' });
    expect(block.close).toHaveBeenCalledOnce();
    expect(finished).toHaveBeenCalledOnce();
    source.dispose();
  });

  it('does not deliver an awaited stale sample after a newer request', async () => {
    const source = await LocalAudioSource.open(new Blob());
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const block = sample(0);
    fake.iterate = async function* () { await gate; yield block; };
    const consume = vi.fn();
    const old = source.readRange(0, 1, consume);
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    fake.iterate = null;
    await source.readRange(2, 3, vi.fn());
    release();
    await rejected;
    expect(consume).not.toHaveBeenCalled();
    expect(block.close).toHaveBeenCalledOnce();
    source.dispose();
  });

  it('supports cancellation and prevents reads after disposal', async () => {
    const source = await LocalAudioSource.open(new Blob());
    const controller = new AbortController();
    controller.abort();
    await expect(source.readRange(0, 1, vi.fn(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    source.dispose(); source.dispose();
    await expect(source.readRange(0, 1, vi.fn())).rejects.toMatchObject({ code: 'disposed' });
  });
});
