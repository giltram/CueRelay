/** Keep transport controls usable and leave room for both timing endpoints. */
const MIN_MEDIA_WIDTH = 300;
const MIN_EDITOR_WIDTH = 480;

/** Height budget includes the subtitle pane and the gap between the two rows. */
export function maximumMediaWidth(layoutHeight: number, subtitleMinimum: number, rowGap: number, videoChrome: number) {
  return Math.max(0, layoutHeight - subtitleMinimum - rowGap - videoChrome) * 16 / 9;
}

export function requiredWorkbenchHeight(mediaWidth: number, videoChrome: number) {
  return mediaWidth * 9 / 16 + videoChrome;
}

export function mediaWidthBounds(availableWidth: number, maximumVideoWidth: number) {
  const remaining = Math.max(0, availableWidth - MIN_EDITOR_WIDTH);
  const minimum = Math.min(MIN_MEDIA_WIDTH, remaining);
  return { minimum, maximum: Math.max(minimum, Math.min(remaining, maximumVideoWidth)) };
}

export function clampMediaWidth(width: number, bounds: ReturnType<typeof mediaWidthBounds>) {
  return Math.min(bounds.maximum, Math.max(bounds.minimum, width));
}
