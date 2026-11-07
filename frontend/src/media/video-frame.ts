import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from 'mediabunny';
import { snapTime, validateInterval } from './playback';

export interface VideoFrameInterval { start: number; end: number }

/** Read presentation timestamps, including VFR/B-frame media, without decoding video.
 * One short-lived input per command; never infer frame duration from playback callbacks. */
export async function readVideoFrame(file: Blob, seconds: number): Promise<VideoFrameInterval> {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('播放器时间无效');
  const input = new Input({ source: new BlobSource(file, { maxCacheSize: 1024 * 1024 }), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('视频中没有可读取的画面轨道');
    const packet = await new EncodedPacketSink(track).getPacket(seconds, { metadataOnly: true });
    if (!packet || seconds >= packet.timestamp + packet.duration - 0.0000001) throw new Error('当前位置没有可读取的视频帧');
    const start = snapTime(Math.max(0, packet.timestamp));
    const end = snapTime(packet.timestamp + packet.duration);
    validateInterval(start, end);
    return { start, end };
  } finally { input.dispose(); }
}
