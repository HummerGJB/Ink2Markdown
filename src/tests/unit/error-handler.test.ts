import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProviderError } from "../../core/errors";
import { isRecoverableError, toAppError } from "../../utils/error-handler";

describe("error-handler", () => {
  it("marks rate-limit provider errors as recoverable", () => {
    const error = new ProviderError("openai", "Too many requests", 429);
    assert.equal(isRecoverableError(error), true);
  });

  it("marks client provider errors as non-recoverable", () => {
    const error = new ProviderError("azure", "Bad request", 400);
    assert.equal(isRecoverableError(error), false);
  });

  it("converts generic errors to app errors", () => {
    const appError = toAppError(new Error("boom"));
    assert.equal(appError.code, "UNEXPECTED_ERROR");
    assert.equal(appError.message, "boom");
  });
});
