export const LINE_BRIGHTNESS_THRESHOLD = 205;
export const LINE_MIN_INK_PIXELS_RATIO = 0.008;
export const LINE_MIN_HEIGHT_PX = 6;
export const LINE_VERTICAL_PADDING_PX = 8;
export const LINE_MERGE_GAP_PX = 8;
export const LINE_CONSENSUS_SIMILARITY = 0.96;

export const DEFAULT_CONCURRENCY = 3;
export const REQUEST_TIMEOUT_MS = 60_000;

export const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
  bmp: "image/bmp"
};
