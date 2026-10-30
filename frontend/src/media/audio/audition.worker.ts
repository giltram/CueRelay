import { safeError } from '../../diagnostics/safety';
import { LocalAudioSource, type PcmChunk } from './local-audio';
import { AUDITION_WINDOW_BYTES, type AuditionRequest, type AuditionResponse } from './audition-protocol';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<AuditionRequest>) => void) | null;
  postMessage(message: AuditionResponse, transfer?: Transferable[]): void;
};
let source: LocalAudioSource | null = null;
// The controller issues one read at a time; terminating this Worker cancels the whole audition.
scope.onmessage = event => {
  const message = event.data;
  void (async () => {
    if (message.type === 'open') {
      source = await LocalAudioSource.open(message.file);
      scope.postMessage({ type: 'ready', metadata: source.metadata });
    } else {
      if (!source) throw Error('试听音轨尚未准备好');
      const chunks: PcmChunk[] = [];
      let bytes = 0;
      const metadata = source.metadata;
      await source.readRange(message.start, message.end, chunk => {
        if (chunk.sampleRate !== metadata.sampleRate || chunk.channels.length !== metadata.channels) {
          throw Error('音轨中途改变采样格式，暂无法试听');
        }
        bytes += chunk.channels.reduce((sum, channel) => sum + channel.byteLength, 0);
        if (bytes > AUDITION_WINDOW_BYTES) throw Error('试听分段超过 PCM 内存预算');
        chunks.push(chunk);
      });
      scope.postMessage({ type: 'pcm', chunks }, chunks.flatMap(chunk => chunk.channels.map(channel => channel.buffer)));
    }
  })().catch(error => scope.postMessage({ type: 'error', diagnostic: safeError(error), message: (error as Error).message }));
};
