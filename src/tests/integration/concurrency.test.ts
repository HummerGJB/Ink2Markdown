import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CancellationToken } from "../../core/cancellation";
import { runWithConcurrency } from "../../services/transcription";

describe("runWithConcurrency", () => {
  it("preserves task ordering in output", async () => {
    const token = new CancellationToken();
    const tasks = [
      async () => {
        await sleep(20);
        return "a";
      },
      async () => {
        await sleep(5);
        return "b";
      },
      async () => "c"
    ];

    const result = await runWithConcurrency(tasks, 2, token);
    assert.deepEqual(result, ["a", "b", "c"]);
  });

  it("rejects with cancellation when token is cancelled", async () => {
    const token = new CancellationToken();
    token.cancel();

    const tasks = [async () => "x"];
    await assert.rejects(async () => {
      await runWithConcurrency(tasks, 1, token);
    });
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
