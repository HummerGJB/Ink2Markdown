import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemoryMonitor } from "../../utils/memory-monitor";

describe("memory-monitor", () => {
  it("produces a report with at least start/end samples", async () => {
    const monitor = new MemoryMonitor({ sampleIntervalMs: 50, leakWarnBytes: 1 });
    monitor.start("unit-test");
    await sleep(80);
    const report = monitor.stop();

    assert.ok(report);
    assert.equal(report?.label, "unit-test");
    assert.equal((report?.sampleCount ?? 0) >= 2, true);
    assert.equal(typeof report?.growthBytes, "number");
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
