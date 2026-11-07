/** Shared applied-cue time contract, matching the ASS codec. No media/DOM dependencies. */
export const MAX_TIME_MS = 35_999_990;

export function validateInterval(start: number, end: number): void {
  if ([start, end].some(t => !Number.isInteger(t) || t < 0 || t > MAX_TIME_MS || t % 10 !== 0)) {
    throw new Error('时间必须非负且对齐 10ms 网格');
  }
  if (start >= end) throw new Error('入点必须早于出点，零长度字幕不会自动拉长');
}
