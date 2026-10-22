// Requires local FFmpeg and installed Chrome. All media is synthetic and stays in a temp directory.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, openSync, writeSync, closeSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'cuerelay-audio-'));
const fixture = name => join(dir, name);
const ffmpeg = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10:duration=120',
  '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000:duration=120',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '35', '-pix_fmt', 'yuv420p',
  '-af', 'pan=stereo|c0=c0|c1=-1*c0', '-c:a', 'aac', '-b:a', '96k', fixture('tail.mp4'));
ffmpeg('-i', fixture('tail.mp4'), '-c', 'copy', '-movflags', '+faststart', fixture('base.mp4'));
ffmpeg('-i', fixture('base.mp4'), '-itsoffset', '2.5', '-i', fixture('base.mp4'),
  '-map', '0:v', '-map', '1:a', '-c', 'copy', '-t', '15', fixture('offset.mp4'));
ffmpeg('-i', fixture('base.mp4'), '-c:v', 'copy', '-an', '-t', '5', fixture('silent.mp4'));
ffmpeg('-i', fixture('base.mp4'), '-c:v', 'copy', '-c:a', 'alac', '-t', '5', fixture('unsupported.mp4'));
writeFileSync(fixture('broken.mp4'), 'this is not a video');

// 5 GiB sparse container: same 120s media, a large valid free box before the tail moov.
// Media byte offsets stay unchanged. This tests file addressing, NOT real multi-hour decode performance.
const tail = readFileSync(fixture('tail.mp4'));
let moov = 0;
while (moov < tail.length && tail.toString('ascii', moov + 4, moov + 8) !== 'moov') moov += tail.readUInt32BE(moov);
assert(moov < tail.length);
const fd = openSync(fixture('sparse-5g.mp4'), 'w');
const freeSize = 5 * 1024 ** 3;
const header = Buffer.alloc(16);
header.writeUInt32BE(1); header.write('free', 4); header.writeBigUInt64BE(BigInt(freeSize), 8);
writeSync(fd, tail.subarray(0, moov), 0, moov, 0);
writeSync(fd, header, 0, header.length, moov);
writeSync(fd, tail.subarray(moov), 0, tail.length - moov, moov + freeSize);
closeSync(fd);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const errors = [];
const uploads = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('request', request => { if (request.method() !== 'GET') uploads.push(request.method() + ' ' + request.url()); });
const report = { browser: browser.version(), fixtureDir: dir, files: {}, ranges: [], errors, uploads };
try {
  await page.goto(process.env.AUDIO_PROBE_URL || 'http://127.0.0.1:5176/experiments/audio-probe.html');
  const result = async status => {
    await page.waitForFunction(expected => {
      const text = document.querySelector('#result').textContent;
      try { const data = JSON.parse(text); return data.status === expected || Boolean(data.error); } catch { return false; }
    }, status);
    return JSON.parse(await page.locator('#result').textContent());
  };
  const open = async name => {
    await page.locator('#file').setInputFiles(fixture(name));
    const value = await result('ready');
    report.files[name] = { bytes: statSync(fixture(name)).size, ...value };
    return value;
  };
  const extract = async (start, end) => {
    await page.locator('#start').fill(String(start));
    await page.locator('#end').fill(String(end));
    await page.locator('#extract').click();
    return result('extracted');
  };
  const opened = await open('base.mp4');
  assert.equal(opened.status, 'ready');
  assert.equal(opened.metadata.codec, 'mp4a.40.2');
  assert.equal(opened.metadata.channels, 2);
  for (const start of [0, 100.123, 5.321, 110.5, 10, 70, 70, 20, 90, 30]) {
    const value = await extract(start, start + 2);
    assert.equal(value.status, 'extracted', JSON.stringify(value));
    assert(Math.abs(value.first - start) < 1 / 48000 + 1e-6);
    assert(Math.abs(value.last - (start + 2)) < 1 / 48000 + 1e-6);
    assert(value.peak > 0.05);
    assert(value.pcmBytes <= 2 * 48000 * 2 * 4 + 16);
    report.ranges.push(value);
  }
  // The same local video remains the only playback source; extraction does not seek/pause it.
  await page.locator('#video').evaluate(async video => { video.currentTime = 35; await video.play(); });
  await extract(80, 82);
  const playing = await page.locator('#video').evaluate(video => ({ paused: video.paused, time: video.currentTime, src: video.src }));
  assert.equal(playing.paused, false); assert(playing.time >= 35 && playing.time < 40); assert(playing.src.startsWith('blob:'));
  report.playingDuringDecode = playing;
  await page.locator('#video').evaluate(video => video.pause());

  assert.equal((await open('offset.mp4')).status, 'ready');
  const gap = await extract(0, 1);
  assert.equal(gap.frames, 0);
  const delayed = await extract(2, 4);
  assert(delayed.first > 2.45 && delayed.first < 2.51);
  assert(delayed.last > 3.99 && delayed.last <= 4.00003);
  report.offset = { gap, delayed };

  assert.equal((await open('tail.mp4')).status, 'ready');
  assert.equal((await extract(100, 102)).status, 'extracted');
  assert.equal((await open('sparse-5g.mp4')).status, 'ready');
  const sparse = await extract(100, 102);
  assert.equal(sparse.status, 'extracted');
  assert(sparse.reads.bytesRead < 32 * 1024 ** 2);
  report.sparse = sparse;

  // Exercise request supersession against the real sink; stale callbacks must stop.
  report.cancellation = await page.evaluate(async () => {
    const { LocalAudioSource } = await import('/src/media/audio/local-audio.ts');
    const file = document.querySelector('#file').files[0];
    const source = await LocalAudioSource.open(file);
    const callbacks = Array(15).fill(0);
    const pending = Array.from({ length: 15 }, (_, i) => source.readRange(i, i + 5, () => callbacks[i]++).then(
      () => 'completed', error => error.name));
    const outcomes = await Promise.all(pending);
    const controller = new AbortController();
    const canceled = source.readRange(70, 75, () => {}, controller.signal).catch(error => error.name);
    controller.abort();
    const canceledName = await canceled;
    const final = await source.readRange(90, 92, () => {});
    const disposePending = source.readRange(0, 10, () => {}).catch(error => error.name);
    source.dispose();
    return { outcomes, callbacks, canceledName, final, disposed: await disposePending };
  });
  assert.deepEqual(report.cancellation.outcomes.slice(0, -1), Array(14).fill('AbortError'));
  assert.deepEqual(report.cancellation.callbacks.slice(0, -1), Array(14).fill(0));
  assert.equal(report.cancellation.outcomes.at(-1), 'completed');
  assert.equal(report.cancellation.canceledName, 'AbortError');
  assert.equal(report.cancellation.disposed, 'AbortError');

  // Heap snapshots after forced GC are indicative retained memory, not peak process/decoder memory.
  const cdp = await page.context().newCDPSession(page);
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    return cdp.send('Runtime.getHeapUsage');
  };
  report.memory = { before: await heap(), after: null, rounds: 30 };
  report.memory.work = await page.evaluate(async () => {
    const { LocalAudioSource } = await import('/src/media/audio/local-audio.ts');
    const file = document.querySelector('#file').files[0];
    const source = await LocalAudioSource.open(file);
    let maxChunkBytes = 0;
    let totalPcmBytes = 0;
    for (let i = 0; i < 30; i++) {
      const result = await source.readRange((i * 37) % 110, (i * 37) % 110 + 5, chunk => {
        maxChunkBytes = Math.max(maxChunkBytes, chunk.channels.reduce((sum, c) => sum + c.byteLength, 0));
      });
      totalPcmBytes += result.pcmBytes;
    }
    const reads = source.diagnostics;
    source.dispose();
    return { maxChunkBytes, totalPcmBytes, reads };
  });
  report.memory.after = await heap();
  assert(report.memory.after.usedSize - report.memory.before.usedSize < 16 * 1024 ** 2);

  report.readFailure = await page.evaluate(async () => {
    const { LocalAudioSource } = await import('/src/media/audio/local-audio.ts');
    const file = new File(['unreadable'], 'failure.mp4');
    file.slice = () => { throw new DOMException('Synthetic file read failure', 'NotReadableError'); };
    try { await LocalAudioSource.open(file); return 'unexpected success'; }
    catch (error) { return error.code; }
  });
  assert.equal(report.readFailure, 'unreadable');

  // Change the selected file while a real decode is pending, then recover.
  await page.locator('#start').fill('0'); await page.locator('#end').fill('10');
  await page.locator('#extract').click();
  assert.equal((await open('silent.mp4')).code, 'no-audio');

  assert.equal((await open('unsupported.mp4')).code, 'unsupported');
  assert.equal((await open('broken.mp4')).code, 'unreadable');
  assert.equal((await open('base.mp4')).status, 'ready');
  await page.locator('#dispose').click();
  assert.equal((await result('disposed')).status, 'disposed');
  assert.deepEqual(errors, []); assert.deepEqual(uploads, []);
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
