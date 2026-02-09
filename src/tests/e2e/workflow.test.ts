import { describe, it } from "node:test";

describe("e2e workflow", () => {
  it("skips in Node-only environment (requires Obsidian runtime)", { skip: true }, () => {
    // Placeholder e2e hook for CI environments that can boot Obsidian.
  });
});
