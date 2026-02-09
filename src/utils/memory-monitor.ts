import type { MemoryReport, MemorySample } from "../core/types";
import { Logger } from "./logger";

interface MemoryMonitorOptions {
  sampleIntervalMs: number;
  leakWarnBytes: number;
  logger?: Logger;
}

const DEFAULT_OPTIONS: MemoryMonitorOptions = {
  sampleIntervalMs: 2000,
  leakWarnBytes: 64 * 1024 * 1024
};

export class MemoryMonitor {
  private readonly options: MemoryMonitorOptions;
  private readonly samples: MemorySample[] = [];
  private timerId: ReturnType<typeof setInterval> | null = null;
  private startedAt = 0;
  private label = "";

  constructor(options?: Partial<MemoryMonitorOptions>) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...(options ?? {})
    };
  }

  start(label: string): void {
    this.stop();
    this.samples.length = 0;
    this.label = label;
    this.startedAt = Date.now();
    this.sample("start");
    this.timerId = setInterval(() => {
      this.sample();
    }, this.options.sampleIntervalMs);
  }

  sample(label?: string): void {
    const snapshot = readCurrentMemory(label);
    if (!snapshot) {
      return;
    }
    this.samples.push(snapshot);
  }

  stop(): MemoryReport | null {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    this.sample("end");

    if (this.samples.length < 2) {
      return null;
    }

    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const peakHeapUsed = this.samples.reduce((max, current) => Math.max(max, current.heapUsed), 0);
    const growthBytes = last.heapUsed - first.heapUsed;
    const growthPercent = first.heapUsed > 0 ? (growthBytes / first.heapUsed) * 100 : 0;
    const leakSuspected =
      growthBytes >= this.options.leakWarnBytes && growthPercent >= 20 && this.samples.length >= 3;

    const report: MemoryReport = {
      label: this.label,
      sampleCount: this.samples.length,
      durationMs: Math.max(0, Date.now() - this.startedAt),
      startHeapUsed: first.heapUsed,
      endHeapUsed: last.heapUsed,
      peakHeapUsed,
      growthBytes,
      growthPercent,
      leakSuspected
    };

    this.options.logger?.info("Memory monitor report", {
      label: report.label,
      samples: report.sampleCount,
      durationMs: report.durationMs,
      startHeapUsed: formatBytes(report.startHeapUsed),
      endHeapUsed: formatBytes(report.endHeapUsed),
      peakHeapUsed: formatBytes(report.peakHeapUsed),
      growthBytes: formatBytes(report.growthBytes),
      growthPercent: Number(report.growthPercent.toFixed(2)),
      leakSuspected: report.leakSuspected
    });

    return report;
  }
}

function readCurrentMemory(label?: string): MemorySample | null {
  const now = Date.now();

  const perfMemory = (globalThis.performance as { memory?: any } | undefined)?.memory;
  if (perfMemory && typeof perfMemory.usedJSHeapSize === "number") {
    return {
      timestamp: now,
      heapUsed: perfMemory.usedJSHeapSize,
      heapTotal: perfMemory.totalJSHeapSize,
      label
    };
  }

  const proc = (globalThis as any).process;
  if (proc?.memoryUsage && typeof proc.memoryUsage === "function") {
    const usage = proc.memoryUsage();
    return {
      timestamp: now,
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      rss: usage.rss,
      label
    };
  }

  return null;
}

function formatBytes(bytes: number): string {
  const negative = bytes < 0;
  const value = Math.abs(bytes);
  if (value < 1024) {
    return `${negative ? "-" : ""}${value} B`;
  }

  const units = ["KB", "MB", "GB"];
  let scaled = value / 1024;
  let index = 0;
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024;
    index += 1;
  }

  return `${negative ? "-" : ""}${scaled.toFixed(1)} ${units[index]}`;
}
