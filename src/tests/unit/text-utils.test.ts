import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  lineSimilarity,
  normalizeLineOutput,
  normalizeTitle,
  sanitizeTitle
} from "../../utils/text-utils";

describe("text-utils", () => {
  it("normalizes titles safely", () => {
    assert.equal(normalizeTitle('"  A Better Title!  "'), "A Better Title!");
  });

  it("removes invalid filename characters", () => {
    assert.equal(sanitizeTitle("A/B:C*D?E\"F<G>H|"), "ABCDEFGH");
  });

  it("normalizes line output to one logical line", () => {
    assert.equal(normalizeLineOutput("alpha\n\n beta"), "alpha beta");
  });

  it("computes high similarity for nearly-identical lines", () => {
    const score = lineSimilarity("- [ ] Finish report", "- [ ] finish report");
    assert.equal(score > 0.95, true);
  });
});
