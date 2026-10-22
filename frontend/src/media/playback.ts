export const MAX_TIME_MS = 35_999_990;

export function snapTime(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('播放器时间无效');
  const milliseconds = Math.round(seconds * 100) * 10;
  if (milliseconds > MAX_TIME_MS) throw new Error('验证台仅支持 10 小时以内的时间');
  return milliseconds;
}

export function formatTime(milliseconds: number): string {
  const cs = Math.round(milliseconds / 10);
  const hours = Math.floor(cs / 360000);
  const minutes = Math.floor(cs / 6000) % 60;
  const seconds = Math.floor(cs / 100) % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}

export function parseTime(text: string): number {
  const match = /^([0-9]):([0-5][0-9]):([0-5][0-9])\.([0-9]{2})$/.exec(text.trim());
  if (!match) throw new Error('时间格式须为 h:mm:ss.cc，例如 0:01:23.45');
  return ((Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 100 + Number(match[4])) * 10;
}

export function validateInterval(start: number, end: number): void {
  if ([start, end].some(t => !Number.isInteger(t) || t < 0 || t > MAX_TIME_MS || t % 10 !== 0)) {
    throw new Error('时间必须非负且对齐 10ms 网格');
  }
  if (start >= end) throw new Error('入点必须早于出点，零长度字幕不会自动拉长');
}

export function seekVideo(video: HTMLVideoElement, milliseconds: number): void {
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || !Number.isFinite(video.duration) || video.readyState < 1) {
    throw new Error('请先加载可播放的视频，并输入有效时间');
  }
  if (milliseconds > video.duration * 1000) throw new Error('定位点超过视频时长，字幕时间未被截断');
  video.currentTime = milliseconds / 1000;
}

export interface ShortcutEvent {
  target: EventTarget | null;
  isComposing: boolean;
  keyCode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
}

/** Structural check keeps this testable without a DOM or cross-window instanceof. */
export function allowsShortcut(event: ShortcutEvent, composing: boolean): boolean {
  if (composing || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat) return false;
  const element = event.target as { closest?: (selector: string) => unknown } | null;
  return !element?.closest?.('input, textarea, select, button, [contenteditable]:not([contenteditable="false"]), [role="textbox"], video');
}
