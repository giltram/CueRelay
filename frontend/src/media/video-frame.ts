import { describe, MessageError } from "../contracts/messages";
import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from 'mediabunny';
import { snapTime, validateInterval } from './playback';

export interface VideoFrameInterval { start: number; end: number }

/** Read presentation timestamps, including VFR/B-frame media, without decoding video.
 * One short-lived input per command; never infer frame duration from playback callbacks. */
export async function readVideoFrame(file: Blob, seconds: number): Promise<VideoFrameInterval> {
  if (!Number.isFinite(seconds) || seconds < 0) throw new MessageError(describe("media.invalidPlayerTime", "播放器时间无效"));
  const input = new Input({ source: new BlobSource(file, { maxCacheSize: 1024 * 1024 }), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new MessageError(describe("media.thisVideoHasNoReadableVideoTrack", "视频中没有可读取的画面轨道"));
    const packet = await new EncodedPacketSink(track).getPacket(seconds, { metadataOnly: true });
    if (!packet || seconds >= packet.timestamp + packet.duration - 0.0000001) throw new MessageError(describe("media.noReadableVideoFrameAtThisPosition", "当前位置没有可读取的视频帧"));
    const start = snapTime(Math.max(0, packet.timestamp));
    const end = snapTime(packet.timestamp + packet.duration);
    validateInterval(start, end);
    if (start === end) throw new MessageError(describe("media.theCurrentFrameIsShorterThan10msA", "当前视频帧不足 10ms，无法读取有效帧区间"));
    return { start, end };
  } finally { input.dispose(); }
}
