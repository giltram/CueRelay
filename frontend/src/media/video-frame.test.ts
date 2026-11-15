import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { readVideoFrame } from './video-frame';

it('reads actual MP4 presentation intervals with B-frame reordering and rejects end of media', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'cuerelay-frames-'));
  try {
    const path = join(folder, 'bframes.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=24:d=2',
      '-c:v', 'libx264', '-bf', '3', '-pix_fmt', 'yuv420p', path]);
    const file = new Blob([readFileSync(path)]);
    expect(await readVideoFrame(file, 0.5)).toEqual({ start: 500, end: 540 });
    expect(await readVideoFrame(file, 0.53)).toEqual({ start: 500, end: 540 });
    expect(await readVideoFrame(file, 0.55)).toEqual({ start: 540, end: 580 });
    await expect(readVideoFrame(file, 2)).rejects.toThrow(/没有可读取/);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});

it('still rejects a frame whose endpoints collapse on the 10ms grid', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'cuerelay-short-frames-'));
  try {
    const path = join(folder, 'short-frames.mp4');
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=64x64:r=240:d=0.1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path]);
    await expect(readVideoFrame(new Blob([readFileSync(path)]), 0)).rejects.toThrow(/不足 10ms/);
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
