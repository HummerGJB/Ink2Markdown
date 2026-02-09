import {
  LINE_BRIGHTNESS_THRESHOLD,
  LINE_MERGE_GAP_PX,
  LINE_MIN_HEIGHT_PX,
  LINE_MIN_INK_PIXELS_RATIO,
  LINE_VERTICAL_PADDING_PX
} from "../constants/config";
import { ERROR_MESSAGES } from "../constants/errors";
import type { LineSlice } from "../core/types";
import { detectInkSpansInWorker } from "./segmentation-worker";

export interface ImageProcessingOptions {
  maxImageDimension: number;
  exportFormat: "png" | "jpeg";
  jpegQuality: number;
  cacheSize: number;
}

export interface ImageProcessingRuntime {
  useWorker: boolean;
  onProgress?: (phase: string, fraction: number) => void;
}

const DEFAULT_OPTIONS: ImageProcessingOptions = {
  maxImageDimension: 2400,
  exportFormat: "png",
  jpegQuality: 0.9,
  cacheSize: 20
};

const segmentationCache = new Map<string, LineSlice[]>();

/**
 * Segments a note image into likely text-line slices for provider transcription.
 * Results can be cached to avoid repeated segmentation for the same image+settings.
 */
export async function segmentImageIntoLines(
  imageDataUrl: string,
  options?: Partial<ImageProcessingOptions>,
  runtime?: Partial<ImageProcessingRuntime>
): Promise<LineSlice[]> {
  const resolved = resolveOptions(options);
  const useWorker = runtime?.useWorker === true;
  const onProgress = runtime?.onProgress;

  const cacheKey = buildCacheKey(imageDataUrl, resolved);
  if (resolved.cacheSize > 0 && segmentationCache.has(cacheKey)) {
    onProgress?.("Using cached segmentation", 1);
    return cloneSlices(segmentationCache.get(cacheKey) ?? []);
  }

  onProgress?.("Decoding image", 0.05);
  const img = await loadImageElement(imageDataUrl);

  onProgress?.("Preprocessing image", 0.2);
  const prepared = preprocessImage(img, resolved.maxImageDimension);
  const width = prepared.width;
  const height = prepared.height;
  if (width <= 0 || height <= 0) {
    return [{ imageDataUrl, top: 0, bottom: 0 }];
  }

  onProgress?.("Detecting text regions", 0.4);
  const imageData = prepared.ctx.getImageData(0, 0, width, height);
  const spans = await detectSpans(imageData, width, height, useWorker);

  if (spans.length === 0) {
    const fallback = [{ imageDataUrl: prepared.canvas.toDataURL(), top: 0, bottom: height }];
    remember(cacheKey, fallback, resolved.cacheSize);
    cleanupCanvas(prepared.canvas);
    onProgress?.("Completed", 1);
    return fallback;
  }

  onProgress?.("Extracting line slices", 0.6);
  const slices: LineSlice[] = [];
  for (let i = 0; i < spans.length; i += 1) {
    const span = spans[i];
    const top = Math.max(0, span.start - LINE_VERTICAL_PADDING_PX);
    const bottom = Math.min(height, span.end + LINE_VERTICAL_PADDING_PX);
    if (bottom - top < LINE_MIN_HEIGHT_PX) {
      continue;
    }

    const lineCanvas = document.createElement("canvas");
    lineCanvas.width = width;
    lineCanvas.height = bottom - top;
    const lineCtx = lineCanvas.getContext("2d");
    if (!lineCtx) {
      continue;
    }

    lineCtx.drawImage(prepared.canvas, 0, top, width, bottom - top, 0, 0, width, bottom - top);
    const mime = resolved.exportFormat === "jpeg" ? "image/jpeg" : "image/png";
    const lineDataUrl =
      resolved.exportFormat === "jpeg"
        ? lineCanvas.toDataURL(mime, resolved.jpegQuality)
        : lineCanvas.toDataURL(mime);

    slices.push({ imageDataUrl: lineDataUrl, top, bottom });
    cleanupCanvas(lineCanvas);
    onProgress?.("Extracting line slices", 0.6 + ((i + 1) / spans.length) * 0.4);
  }

  const result = slices.length > 0 ? slices : [{ imageDataUrl: prepared.canvas.toDataURL(), top: 0, bottom: height }];
  remember(cacheKey, result, resolved.cacheSize);
  cleanupCanvas(prepared.canvas);
  onProgress?.("Completed", 1);

  return cloneSlices(result);
}

export function clearSegmentationCache(): void {
  segmentationCache.clear();
}

async function detectSpans(
  imageData: ImageData,
  width: number,
  height: number,
  useWorker: boolean
): Promise<Array<{ start: number; end: number }>> {
  if (useWorker) {
    try {
      const cloned = new Uint8ClampedArray(imageData.data);
      const result = await detectInkSpansInWorker({
        data: cloned.buffer,
        width,
        height,
        brightnessThreshold: LINE_BRIGHTNESS_THRESHOLD,
        minInkPixelsRatio: LINE_MIN_INK_PIXELS_RATIO,
        minHeightPx: LINE_MIN_HEIGHT_PX,
        mergeGapPx: LINE_MERGE_GAP_PX
      });
      return result.spans;
    } catch {
      return findInkSpans(detectInkRows(imageData, width, height), width);
    }
  }

  return findInkSpans(detectInkRows(imageData, width, height), width);
}

function remember(cacheKey: string, value: LineSlice[], cacheSize: number): void {
  if (cacheSize <= 0) {
    return;
  }
  segmentationCache.set(cacheKey, cloneSlices(value));
  while (segmentationCache.size > cacheSize) {
    const first = segmentationCache.keys().next().value;
    if (!first) {
      break;
    }
    segmentationCache.delete(first);
  }
}

function preprocessImage(
  img: HTMLImageElement,
  maxImageDimension: number
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; width: number; height: number } {
  const sourceWidth = img.naturalWidth || img.width;
  const sourceHeight = img.naturalHeight || img.height;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    const emptyCanvas = document.createElement("canvas");
    const emptyCtx = emptyCanvas.getContext("2d");
    if (!emptyCtx) {
      throw new Error(ERROR_MESSAGES.CANVAS_CONTEXT);
    }
    return { canvas: emptyCanvas, ctx: emptyCtx, width: 0, height: 0 };
  }

  const scale = Math.min(1, maxImageDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error(ERROR_MESSAGES.CANVAS_CONTEXT);
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);

  return { canvas, ctx, width, height };
}

function loadImageElement(imageDataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(ERROR_MESSAGES.IMAGE_LOAD));
    img.src = imageDataUrl;
  });
}

function detectInkRows(imageData: ImageData, width: number, height: number): number[] {
  const rowInk = new Array<number>(height).fill(0);
  const data = imageData.data;

  for (let y = 0; y < height; y += 1) {
    let darkPixels = 0;
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      const idx = rowOffset + x * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      if (brightness <= LINE_BRIGHTNESS_THRESHOLD) {
        darkPixels += 1;
      }
    }
    rowInk[y] = darkPixels;
  }

  return smoothRowInk(rowInk);
}

function smoothRowInk(rows: number[]): number[] {
  if (rows.length <= 2) {
    return rows.slice();
  }
  const smoothed = new Array<number>(rows.length);
  smoothed[0] = rows[0];
  smoothed[rows.length - 1] = rows[rows.length - 1];
  for (let i = 1; i < rows.length - 1; i += 1) {
    smoothed[i] = Math.round((rows[i - 1] + rows[i] + rows[i + 1]) / 3);
  }
  return smoothed;
}

function findInkSpans(rows: number[], width: number): Array<{ start: number; end: number }> {
  const minInkPixels = Math.max(6, Math.floor(width * LINE_MIN_INK_PIXELS_RATIO));
  const spans: Array<{ start: number; end: number }> = [];
  let start = -1;

  for (let y = 0; y < rows.length; y += 1) {
    const hasInk = rows[y] >= minInkPixels;
    if (hasInk && start === -1) {
      start = y;
    }
    if (!hasInk && start !== -1) {
      spans.push({ start, end: y });
      start = -1;
    }
  }

  if (start !== -1) {
    spans.push({ start, end: rows.length });
  }

  const merged = mergeNearbySpans(spans, LINE_MERGE_GAP_PX);
  return merged.filter((span) => span.end - span.start >= LINE_MIN_HEIGHT_PX);
}

function mergeNearbySpans(
  spans: Array<{ start: number; end: number }>,
  gap: number
): Array<{ start: number; end: number }> {
  if (spans.length === 0) {
    return [];
  }
  const merged: Array<{ start: number; end: number }> = [spans[0]];
  for (let i = 1; i < spans.length; i += 1) {
    const current = spans[i];
    const last = merged[merged.length - 1];
    if (current.start - last.end <= gap) {
      last.end = Math.max(last.end, current.end);
      continue;
    }
    merged.push({ ...current });
  }
  return merged;
}

function resolveOptions(options?: Partial<ImageProcessingOptions>): ImageProcessingOptions {
  const merged = { ...DEFAULT_OPTIONS, ...(options ?? {}) };
  return {
    maxImageDimension: Math.max(600, Math.round(merged.maxImageDimension)),
    exportFormat: merged.exportFormat === "jpeg" ? "jpeg" : "png",
    jpegQuality: Math.min(1, Math.max(0.2, merged.jpegQuality)),
    cacheSize: Math.max(0, Math.round(merged.cacheSize))
  };
}

function buildCacheKey(imageDataUrl: string, options: ImageProcessingOptions): string {
  return `${options.maxImageDimension}|${options.exportFormat}|${options.jpegQuality}|${imageDataUrl}`;
}

function cloneSlices(slices: LineSlice[]): LineSlice[] {
  return slices.map((slice) => ({ ...slice }));
}

function cleanupCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 1;
  canvas.height = 1;
}
