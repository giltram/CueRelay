// Actual Web Audio render-thread PCM, MP4/WebCodecs and workbench lifecycle checks.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { uiDocument } from './ass-codec.mjs';
import { checkShortcutFocus } from './shortcut-focus-checks.mjs';
import { unavailableAssPreview } from './ass-preview-fixture.mjs';

const artifacts = mkdtempSync(join(tmpdir(), 'cuerelay-audition-'));
const file = join(artifacts, 'stereo.mp4'), silent = join(artifacts, 'silent.mp4'), unsupported = join(artifacts, 'unsupported.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
  'testsrc2=size=160x90:rate=25:duration=18', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=18',
  '-af', 'pan=stereo|c0=c0|c1=-1*c0', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', file]);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-c:v', 'copy', '-an', silent]);
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-c:v', 'copy', '-c:a', 'alac', unsupported]);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage(), errors = [], unexpected = [];
page.on('pageerror', error => errors.push(String(error)));
let overrides = {};
await context.route('**/api/**', async route => {
  if (await unavailableAssPreview(route)) return;
  if (new URL(route.request().url()).pathname === '/api/ass/import') return route.continue();
  const fixtures = {
    '/api/auth/session': { user: { id: 1, username: 'audition-fixture', is_dev: false } },
    '/api/organizations': { organizations: [] },
    '/api/me/settings': { shortcut_overrides: overrides, audio_display_mode: 'spectrum', mouse_sets_cue_boundary: true },
    '/api/ass/empty': { document: uiDocument() },
  };
  const path = new URL(route.request().url()).pathname;
  if (route.request().method() === 'GET' && fixtures[path]) return route.fulfill({ json: fixtures[path] });
  unexpected.push(`${route.request().method()} ${path}`); return route.abort();
});
// Observe native starts/stops, connections and closed contexts without changing output routing.
await context.addInitScript(() => {
  window.__audio = { contexts: [], nodes: [], workers: 0 };
  const Native = window.AudioContext;
  window.AudioContext = class extends Native {
    constructor(...args) {
      super(...args); window.__audio.contexts.push(this);
      const create = this.createBufferSource.bind(this);
      this.createBufferSource = () => {
        const node = create(), info = { node, connected: false, starts: [], stops: [] };
        window.__audio.nodes.push(info);
        const connect = node.connect.bind(node), disconnect = node.disconnect.bind(node), start = node.start.bind(node), stop = node.stop.bind(node);
        node.connect = (...args) => { info.connected = true; return connect(...args); };
        node.disconnect = (...args) => { info.connected = false; return disconnect(...args); };
        node.start = (...args) => { info.starts.push(args); return start(...args); };
        node.stop = (...args) => { info.stops.push(args); return stop(...args); };
        return node;
      };
    }
  };
  const WorkerNative = window.Worker;
  window.Worker = class extends WorkerNative {
    constructor(...args) { super(...args); window.__audio.workers++; }
    terminate() { window.__audio.workers--; return super.terminate(); }
  };
});
const base = process.env.AUDIO_AUDITION_URL || 'http://127.0.0.1:5173';
const report = { browser: browser.version(), artifacts };
try {
  await page.goto(`${base}/experiments/audio-audition.html`);
  // Test the production scheduler's rendered PCM, including a test tone immediately AFTER out.
  report.offline = await page.evaluate(async () => {
    const { scheduleAuditionChunks } = await import('/src/media/audio/audition-controller.ts');
    const sr = 48000, results = [];
    for (const [start, end] of [[.010, .011], [1.99, 2.03], [.123, 15.123]]) {
      const length = Math.ceil((end + .05) * sr), channels = [new Float32Array(length), new Float32Array(length)];
      for (let i = 0; i < length; i++) {
        const selected = i >= Math.round(start * sr) && i < Math.round(end * sr);
        // Nonselected test signal uses much larger amplitude to detect contamination.
        channels[0][i] = selected ? .125 : .875; channels[1][i] = -channels[0][i];
      }
      const context = new OfflineAudioContext(2, Math.ceil((end - start + .1) * sr), sr);
      const nodes = new Set();
      // Simulate segmented PCM with preserved timestamps; the range crosses the 2s boundary.
      for (let frame = 0; frame < length; frame += 2 * sr) {
        scheduleAuditionChunks(context, [{ timestamp: frame / sr, sampleRate: sr,
          channels: channels.map(c => c.subarray(frame, Math.min(length, frame + 2 * sr))) }],
        { start: start * 1000, end: end * 1000 }, .025, nodes);
      }
      const rendered = await context.startRendering();
      const first = Math.round(.025 * sr), last = first + Math.round((end - start) * sr);
      let outside = 0, error = 0;
      for (let c = 0; c < 2; c++) {
        const data = rendered.getChannelData(c);
        for (let i = 0; i < data.length; i++) {
          if (i < first || i >= last) outside = Math.max(outside, Math.abs(data[i]));
          else error = Math.max(error, Math.abs(data[i] - (c ? -.125 : .125)));
        }
      }
      results.push({ start, end, outside, error });
    }
    return results;
  });
  for (const result of report.offline) { assert.equal(result.outside, 0); assert.equal(result.error, 0); }

  report.stall = await page.evaluate(async () => {
    const { AudioAuditionController } = await import('/src/media/audio/audition-controller.ts');
    const ctx = new AudioContext({ sampleRate: 48000 });
    await ctx.audioWorklet.addModule('/experiments/audition-capture.worklet.js');
    const capture = new AudioWorkletNode(ctx, 'audition-capture', { outputChannelCount: [2] }); capture.connect(ctx.destination);
    const blocks = [];
    capture.port.onmessage = event => blocks.push(event.data);
    const create = ctx.createBufferSource.bind(ctx);
    ctx.createBufferSource = () => { const node = create(); node.connect = () => AudioNode.prototype.connect.call(node, capture); return node; };
    const sr = 48000, samples = new Float32Array(sr).fill(.125);
    // Selected 200ms has amplitude .125; a loud 3kHz test tone starts exactly at out.
    for (let i = 9600; i < samples.length; i++) samples[i] = .8 * Math.sin(2 * Math.PI * 3000 * i / sr);
    const reader = { open: async () => ({ sampleRate: sr, channels: 2 }), dispose() {},
      // Deliberately return uncropped source: the scheduler must enforce the boundary too.
      read: async () => [{ timestamp: 0, sampleRate: sr, channels: [samples, samples] }] };
    const controller = new AudioAuditionController(() => reader, () => {}, () => ctx);
    await controller.start({ start: 0, end: 200 });
    const origin = window.__audio.nodes.at(-1).starts[0][0];
    while (ctx.currentTime < origin + .17) await new Promise(resolve => setTimeout(resolve, 5));
    const before = ctx.currentTime, until = performance.now() + 80;
    while (performance.now() < until) {} // Cross the scheduled out point while JS is blocked.
    const after = ctx.currentTime;
    await new Promise(resolve => setTimeout(resolve, 150));
    let peak = 0, afterOutPeak = 0;
    for (const block of blocks) for (const channel of block.channels) for (let i = 0; i < channel.length; i++) {
      peak = Math.max(peak, Math.abs(channel[i]));
      if ((block.frame + i) / sr >= origin + .2 + 1e-6) afterOutPeak = Math.max(afterOutPeak, Math.abs(channel[i]));
    }
    const result = { before, after, out: origin + .2, peak, afterOutPeak, blocks: blocks.length, phase: controller.state.phase };
    controller.dispose(); capture.disconnect(); return result;
  });
  assert(report.stall.before < report.stall.out && report.stall.after > report.stall.out, JSON.stringify(report.stall));
  assert(report.stall.blocks > 20); assert.equal(report.stall.peak, .125); assert.equal(report.stall.afterOutPeak, 0); assert.equal(report.stall.phase, 'finished');

  // Actual independent Worker: MP4 decode, long streaming, replacement, errors, hide and unmount.
  await page.locator('#file').setInputFiles(file);
  const probePhase = phase => page.waitForFunction(phase => JSON.parse(document.querySelector('#state').textContent).phase === phase, phase);
  await page.locator('#long').click(); await probePhase('playing');
  await page.waitForTimeout(2300);
  assert(Number(await page.locator('#position').textContent()) > 2000);
  await probePhase('finished'); assert.equal(JSON.parse(await page.locator('#state').textContent()).position, 15000);
  await page.locator('#start').click(); await probePhase('finished');
  assert.equal(JSON.parse(await page.locator('#state').textContent()).position, 1870);
  await page.locator('#long').click(); await probePhase('playing');
  await page.locator('#file').setInputFiles(silent); await probePhase('idle');
  await page.locator('#start').click(); await probePhase('error'); assert.match(await page.locator('#state').textContent(), /没有音轨/);
  await page.locator('#file').setInputFiles(unsupported); await probePhase('idle');
  await page.locator('#start').click(); await probePhase('error'); assert.match(await page.locator('#state').textContent(), /无法.*解码/);
  await page.locator('#file').setInputFiles(file); await probePhase('idle');
  await page.locator('#long').click(); await probePhase('playing');
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide'))); await probePhase('idle');
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await page.locator('#long').click(); await probePhase('playing');
  await page.locator('#hide').click(); await probePhase('idle');
  await page.locator('#hide').click();
  await page.locator('#long').click(); await probePhase('playing');
  await page.locator('#mount').click();
  await page.waitForFunction(() => window.__audio.contexts.every(c => c.state === 'closed') && window.__audio.nodes.every(n => !n.connected));
  assert.equal(await page.evaluate(() => window.__audio.workers), 0);
  report.lifecycle = true;

  await page.goto(`${base}/workspace/local`);
  await page.getByLabel('导入本地视频').setInputFiles(file);
  const timeline = page.locator('.audio-timeline'), video = page.locator('video');
  await page.waitForFunction(() => document.querySelector('.audio-timeline')?.dataset.state === 'ready');
  const phase = p => page.waitForFunction(p => document.querySelector('.audio-timeline')?.dataset.auditionPhase === p, p);
  const start = page.getByRole('textbox', { name: '入点', exact: true }), end = page.getByRole('textbox', { name: '出点', exact: true });
  await start.fill('0:00:01.23'); await end.fill('0:00:01.87');
  await video.evaluate(v => { v.currentTime = 5; }); await page.waitForFunction(() => !document.querySelector('video').seeking);
  const snapshot = await page.locator('.cue-list tbody').innerText();
  const audition = async key => { await page.locator('main').focus(); await page.keyboard.press(key); await phase('playing'); };
  await audition('Space');
  await page.waitForFunction(() => Number(document.querySelector('.audio-timeline').dataset.auditionTime) > 1400);
  assert(await video.evaluate(v => v.paused && v.currentTime === 5));
  assert.equal(await page.locator('.video-progress').inputValue(), '5000');
  await phase('finished'); assert.equal(await timeline.getAttribute('data-audition-time'), '1870');
  // Q/W/E/D keep their existing interval calculations, all without moving video.
  for (const [key, endpoint] of [['KeyQ', 1230], ['KeyW', 2370], ['KeyE', 1730], ['KeyD', 1870]]) {
    await audition(key); await phase('finished');
    assert.equal(Number(await timeline.getAttribute('data-audition-time')), endpoint);
    assert(await video.evaluate(v => v.paused && v.currentTime === 5));
  }
  // Repeated requests start afresh; frequency view requests never cancel the audition.
  await start.fill('0:00:00.00'); await end.fill('0:00:15.00');
  await audition('Space'); await page.waitForTimeout(350);
  await page.keyboard.press('KeyS'); await phase('playing');
  assert(Number(await timeline.getAttribute('data-audition-time')) < 350);
  const stage = page.locator('.audio-stage'); await stage.hover();
  await page.mouse.wheel(0, 200); await page.keyboard.down('Shift'); await page.mouse.wheel(0, -100); await page.keyboard.up('Shift');
  await page.waitForTimeout(400); assert.equal(await timeline.getAttribute('data-audition-phase'), 'playing');
  // Ordinary playback and active seek synchronously cancel every scheduled audition node.
  await page.getByRole('button', { name: '播放 / 暂停', exact: true }).click();
  await phase('idle'); await page.waitForFunction(() => !document.querySelector('video').paused);
  assert(await page.evaluate(() => window.__audio.nodes.every(n => !n.connected)));
  await audition('Space'); assert(await video.evaluate(v => v.paused));
  await page.locator('.video-progress').fill('7000'); await phase('idle');
  assert(await video.evaluate(v => v.paused && Math.abs(v.currentTime - 7) < .01));
  assert(await page.evaluate(() => window.__audio.nodes.every(n => !n.connected)));
  // Focus / IME guards and personal shortcut configuration remain in control.
  await start.focus(); await page.keyboard.press('Space'); assert.equal(await timeline.getAttribute('data-audition-phase'), 'idle');
  await start.fill('0:00:00.00'); await page.locator('main').focus();
  await page.locator('main').dispatchEvent('compositionstart'); await page.keyboard.press('Space');
  await page.locator('main').dispatchEvent('compositionend'); assert.equal(await timeline.getAttribute('data-audition-phase'), 'idle');
  overrides = { selection: ['KeyR'] };
  await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/api/me/settings'), page.evaluate(() => dispatchEvent(new Event('focus')))]);
  await page.waitForTimeout(50); await page.keyboard.press('Space'); assert.equal(await timeline.getAttribute('data-audition-phase'), 'idle');
  await audition('KeyR');
  const beforeFullscreen = await video.evaluate(v => v.currentTime);
  await page.getByRole('button', { name: '切换视频全屏', exact: true }).click(); await phase('idle');
  assert(await video.evaluate((v, t) => v.paused && v.currentTime === t, beforeFullscreen));
  await page.keyboard.press('Space'); await page.waitForFunction(() => !document.querySelector('video').paused);
  await page.keyboard.press('Space'); assert(await video.evaluate(v => v.paused));
  await page.evaluate(() => document.exitFullscreen());
  assert.equal(await page.locator('.cue-list tbody').innerText(), snapshot);
  assert.equal(await start.inputValue(), '0:00:00.00'); assert.equal(await end.inputValue(), '0:00:15.00');
  await audition('KeyR');
  await page.getByRole('link', { name: 'CueRelay', exact: true }).click();
  await page.waitForFunction(() => window.__audio.contexts.every(c => c.state === 'closed'));
  assert(await page.evaluate(() => window.__audio.nodes.every(n => !n.connected)));
  report.workbench = true;
  overrides = {};
  report.shortcutFocus = await checkShortcutFocus({ newPage: options => context.newPage(options) }, `${base}/workspace/local`, file);
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  writeFileSync(join(artifacts, 'result.json'), JSON.stringify(report, null, 2));
  console.log('PASS', JSON.stringify(report, null, 2));
} catch (error) {
  await page.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
  console.error('artifacts:', artifacts, error); throw error;
} finally { await context.close(); await browser.close(); }
