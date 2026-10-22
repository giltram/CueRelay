/** Keep transport controls usable and leave room for both timing endpoints. */
const MIN_MEDIA_WIDTH = 300;
const MIN_EDITOR_WIDTH = 480;

export function mediaWidthBounds(availableWidth: number, maximumVideoWidth: number) {
  const remaining = Math.max(0, availableWidth - MIN_EDITOR_WIDTH);
  const minimum = Math.min(MIN_MEDIA_WIDTH, remaining);
  return { minimum, maximum: Math.max(minimum, Math.min(remaining, maximumVideoWidth)) };
}

export function clampMediaWidth(width: number, bounds: ReturnType<typeof mediaWidthBounds>) {
  return Math.min(bounds.maximum, Math.max(bounds.minimum, width));
}
