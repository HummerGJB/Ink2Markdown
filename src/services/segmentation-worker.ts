export interface WorkerSegmentationRequest {
  data: ArrayBuffer;
  width: number;
  height: number;
  brightnessThreshold: number;
  minInkPixelsRatio: number;
  minHeightPx: number;
  mergeGapPx: number;
}

export interface WorkerSegmentationResponse {
  spans: Array<{ start: number; end: number }>;
}

interface WorkerMessageRequest extends WorkerSegmentationRequest {
  id: number;
}

interface WorkerMessageResponse {
  id: number;
  spans?: Array<{ start: number; end: number }>;
  error?: string;
}

let workerInstance: Worker | null = null;
let workerUrl: string | null = null;
let requestCounter = 0;
const pending = new Map<
  number,
  {
    resolve: (value: WorkerSegmentationResponse) => void;
    reject: (reason?: unknown) => void;
  }
>();

export async function detectInkSpansInWorker(
  request: WorkerSegmentationRequest
): Promise<WorkerSegmentationResponse> {
  const worker = getWorker();
  if (!worker) {
    throw new Error("Worker unavailable.");
  }

  const id = ++requestCounter;

  return new Promise<WorkerSegmentationResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject });

    const message: WorkerMessageRequest = {
      id,
      ...request
    };

    worker.postMessage(message, [request.data]);
  });
}

export function disposeSegmentationWorker(): void {
  for (const request of pending.values()) {
    request.reject(new Error("Worker disposed."));
  }
  pending.clear();

  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
  }
  if (workerUrl) {
    URL.revokeObjectURL(workerUrl);
    workerUrl = null;
  }
}

function getWorker(): Worker | null {
  if (typeof Worker === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") {
    return null;
  }

  if (workerInstance) {
    return workerInstance;
  }

  const script = buildWorkerScript();
  const blob = new Blob([script], { type: "application/javascript" });
  workerUrl = URL.createObjectURL(blob);
  workerInstance = new Worker(workerUrl);

  workerInstance.onmessage = (event: MessageEvent<WorkerMessageResponse>) => {
    const payload = event.data;
    const target = pending.get(payload.id);
    if (!target) {
      return;
    }
    pending.delete(payload.id);

    if (payload.error) {
      target.reject(new Error(payload.error));
      return;
    }

    target.resolve({
      spans: payload.spans ?? []
    });
  };

  workerInstance.onerror = (event) => {
    for (const request of pending.values()) {
      request.reject(new Error(event.message || "Worker error."));
    }
    pending.clear();
  };

  return workerInstance;
}

function buildWorkerScript(): string {
  return `
self.onmessage = function(event) {
  const req = event.data;
  try {
    const data = new Uint8ClampedArray(req.data);
    const width = req.width;
    const height = req.height;
    const rowInk = new Array(height).fill(0);

    for (let y = 0; y < height; y += 1) {
      let darkPixels = 0;
      const rowOffset = y * width * 4;
      for (let x = 0; x < width; x += 1) {
        const idx = rowOffset + x * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
        if (brightness <= req.brightnessThreshold) {
          darkPixels += 1;
        }
      }
      rowInk[y] = darkPixels;
    }

    const smoothed = rowInk.slice();
    if (rowInk.length > 2) {
      for (let i = 1; i < rowInk.length - 1; i += 1) {
        smoothed[i] = Math.round((rowInk[i - 1] + rowInk[i] + rowInk[i + 1]) / 3);
      }
    }

    const minInkPixels = Math.max(6, Math.floor(width * req.minInkPixelsRatio));
    const spans = [];
    let start = -1;

    for (let y = 0; y < smoothed.length; y += 1) {
      const hasInk = smoothed[y] >= minInkPixels;
      if (hasInk && start === -1) {
        start = y;
      }
      if (!hasInk && start !== -1) {
        spans.push({ start, end: y });
        start = -1;
      }
    }

    if (start !== -1) {
      spans.push({ start, end: smoothed.length });
    }

    const merged = [];
    for (let i = 0; i < spans.length; i += 1) {
      const current = spans[i];
      if (merged.length === 0) {
        merged.push({ start: current.start, end: current.end });
        continue;
      }

      const last = merged[merged.length - 1];
      if (current.start - last.end <= req.mergeGapPx) {
        last.end = Math.max(last.end, current.end);
      } else {
        merged.push({ start: current.start, end: current.end });
      }
    }

    const filtered = merged.filter((span) => span.end - span.start >= req.minHeightPx);

    self.postMessage({ id: req.id, spans: filtered });
  } catch (error) {
    self.postMessage({ id: req.id, error: error && error.message ? error.message : 'Worker failed.' });
  }
};`;
}
