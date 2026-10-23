import { describe, expect, it } from 'vitest';
import { hashBlob } from './file-hash';
import { matchesMedia } from './media-manifest';

describe('bounded full-file hashing', () => {
  it('matches a known SHA-256 across separate chunks and reports full progress', async () => {
    const progress: number[] = [];
    expect(await hashBlob(new Blob(['abc']), value => progress.push(value), undefined, 1))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(progress).toEqual([1 / 3, 2 / 3, 1]);
  });
  it('cancels before reading or between bounded chunks', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(hashBlob(new Blob(['abc']), () => {}, controller.signal, 1)).rejects.toMatchObject({ name: 'AbortError' });
    const second = new AbortController();
    await expect(hashBlob(new Blob(['abc']), () => second.abort(), second.signal, 1)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('requires both exact size and full digest for media matching', () => {
    const manifest = { sha256: 'abc', size: 20, duration_ms: 1000 };
    expect(matchesMedia({ size: 20 }, 'abc', manifest)).toBe(true);
    expect(matchesMedia({ size: 21 }, 'abc', manifest)).toBe(false);
    expect(matchesMedia({ size: 20 }, 'abcd', manifest)).toBe(false);
  });
});
