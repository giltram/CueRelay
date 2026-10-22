import { LocalAudioSource } from '../src/media/audio/local-audio';

const fileInput = document.querySelector<HTMLInputElement>('#file')!;
const video = document.querySelector<HTMLVideoElement>('#video')!;
const output = document.querySelector<HTMLPreElement>('#result')!;
let source: LocalAudioSource | null = null;
let opening: AbortController | null = null;
let url = '';
let generation = 0;

const display = (value: unknown) => { output.textContent = JSON.stringify(value, null, 2); };
const errorResult = (error: unknown) => {
  const value = error as Error & { code?: string };
  return { error: value.message, code: value.code || value.name };
};

function clear() {
  generation++;
  opening?.abort(); opening = null;
  source?.dispose(); source = null;
}

fileInput.addEventListener('change', async () => {
  clear();
  video.pause(); video.removeAttribute('src'); video.load();
  URL.revokeObjectURL(url);
  const file = fileInput.files?.[0];
  if (!file) return;
  // The identical File is used for playback and extraction. No second picker or media player.
  video.src = url = URL.createObjectURL(file);
  opening = new AbortController();
  const current = generation;
  const started = performance.now();
  display({ status: 'opening' });
  try {
    const next = await LocalAudioSource.open(file, opening.signal);
    if (current !== generation) { next.dispose(); return; }
    source = next;
    display({ status: 'ready', fileBytes: file.size, openMs: performance.now() - started,
      metadata: source.metadata, reads: source.diagnostics });
  } catch (error) {
    if (current === generation) display(errorResult(error));
  }
});

document.querySelector('#extract')!.addEventListener('click', async () => {
  if (!source) { display({ error: '请先打开可提取音频的视频' }); return; }
  const audio = source;
  const current = ++generation;
  const start = Number(document.querySelector<HTMLInputElement>('#start')!.value);
  const end = Number(document.querySelector<HTMLInputElement>('#end')!.value);
  const started = performance.now();
  const before = audio.diagnostics.bytesRead;
  let peak = 0;
  let frames = 0;
  let first: number | null = null;
  let last: number | null = null;
  display({ status: 'decoding' });
  try {
    const result = await audio.readRange(start, end, chunk => {
      first ??= chunk.timestamp;
      last = chunk.timestamp + chunk.channels[0].length / chunk.sampleRate;
      frames += chunk.channels[0].length;
      for (const channel of chunk.channels) for (const value of channel) peak = Math.max(peak, Math.abs(value));
    });
    if (current === generation) display({ status: 'extracted', start, end, first, last, frames, peak,
      ...result, elapsedMs: performance.now() - started, newReadBytes: audio.diagnostics.bytesRead - before,
      reads: audio.diagnostics });
  } catch (error) {
    if (current === generation) display(errorResult(error));
  }
});
document.querySelector('#dispose')!.addEventListener('click', () => { clear(); display({ status: 'disposed' }); });
window.addEventListener('pagehide', () => { clear(); URL.revokeObjectURL(url); });
