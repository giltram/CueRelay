/** Prefer usable controls, while allowing height-limited frames to fit their column. */
const MIN_MEDIA_WIDTH = 300;
const MIN_EDITOR_WIDTH = 480;
const PREFERRED_DEFAULT_MEDIA_WIDTH = 400;

/** Preserve the preferred frame size, but return height-limited whitespace to the editor. */
export function defaultMediaWidth(availableWidth: number, defaultShare: number, maximumVideoWidth: number) {
  return clampMediaWidth(Math.max(PREFERRED_DEFAULT_MEDIA_WIDTH, availableWidth * defaultShare),
    mediaWidthBounds(availableWidth, maximumVideoWidth));
}

/** Height budget includes the subtitle pane and the gap between the two rows. */
export function maximumMediaWidth(layoutHeight: number, subtitleMinimum: number, rowGap: number, videoChrome: number) {
  return Math.max(0, layoutHeight - subtitleMinimum - rowGap - videoChrome) * 16 / 9;
}

export function requiredWorkbenchHeight(mediaWidth: number, videoChrome: number) {
  return mediaWidth * 9 / 16 + videoChrome;
}

export function mediaWidthBounds(availableWidth: number, maximumVideoWidth: number) {
  const remaining = Math.max(0, availableWidth - MIN_EDITOR_WIDTH);
  const maximum = Math.max(0, Math.min(remaining, maximumVideoWidth));
  return { minimum: Math.min(MIN_MEDIA_WIDTH, maximum), maximum };
}

export function clampMediaWidth(width: number, bounds: ReturnType<typeof mediaWidthBounds>) {
  return Math.min(bounds.maximum, Math.max(bounds.minimum, width));
}
