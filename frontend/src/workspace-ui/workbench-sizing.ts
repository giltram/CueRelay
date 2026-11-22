/** Keep transport controls usable and leave room for both timing endpoints. */
const MIN_MEDIA_WIDTH = 300;
const MIN_EDITOR_WIDTH = 480;
const DEFAULT_MEDIA_MIN_WIDTH = 400;

/** Keep the default transport on one row even when height limits the video frame. */
export function defaultMediaWidth(availableWidth: number, defaultShare: number, maximumVideoWidth: number) {
  return clampMediaWidth(Math.max(DEFAULT_MEDIA_MIN_WIDTH, availableWidth * defaultShare),
    mediaWidthBounds(availableWidth, Math.max(DEFAULT_MEDIA_MIN_WIDTH, maximumVideoWidth)));
}

/** Height budget includes the subtitle pane and the gap between the two rows. */
export function maximumMediaWidth(layoutHeight: number, subtitleMinimum: number, rowGap: number, videoChrome: number) {
  return Math.max(0, layoutHeight - subtitleMinimum - rowGap - videoChrome) * 16 / 9;
}

export function requiredWorkbenchHeight(mediaWidth: number, videoChrome: number, videoWidthGap = 0) {
  return Math.max(0, mediaWidth - videoWidthGap) * 9 / 16 + videoChrome;
}

export function mediaWidthBounds(availableWidth: number, maximumVideoWidth: number, videoWidthGap = 0) {
  const remaining = Math.max(0, availableWidth - MIN_EDITOR_WIDTH);
  const minimum = Math.min(MIN_MEDIA_WIDTH, remaining);
  return { minimum, maximum: Math.max(minimum, Math.min(remaining, maximumVideoWidth + videoWidthGap)) };
}

export function clampMediaWidth(width: number, bounds: ReturnType<typeof mediaWidthBounds>) {
  return Math.min(bounds.maximum, Math.max(bounds.minimum, width));
}
