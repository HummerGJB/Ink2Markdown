import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getProviderConfig, migrateSettings } from "../../core/settings";

describe("settings", () => {
  it("migrates missing fields and clamps invalid values", () => {
    const settings = migrateSettings({
      provider: "openai",
      maxConcurrency: -10,
      maxRequestsPerSecond: 999,
      maxLineRetries: 99,
      maxPageRetries: -2,
      maxImageDimension: 100,
      imageJpegQuality: 2,
      responseCacheTtlMs: 1,
      responseCacheMaxEntries: 9,
      responseCacheMaxBytesMb: 1,
      memorySampleIntervalMs: 100,
      memoryLeakWarnMb: 1
    });

    assert.equal(settings.maxConcurrency, 1);
    assert.equal(settings.maxRequestsPerSecond, 20);
    assert.equal(settings.maxLineRetries, 4);
    assert.equal(settings.maxPageRetries, 0);
    assert.equal(settings.maxImageDimension, 600);
    assert.equal(settings.imageJpegQuality, 1);
    assert.equal(settings.responseCacheTtlMs, 10_000);
    assert.equal(settings.responseCacheMaxEntries, 10);
    assert.equal(settings.responseCacheMaxBytesMb, 10);
    assert.equal(settings.memorySampleIntervalMs, 500);
    assert.equal(settings.memoryLeakWarnMb, 16);
  });

  it("builds openai provider config", () => {
    const settings = migrateSettings({
      provider: "openai",
      openaiApiKey: " key ",
      openaiModel: " model "
    });

    const config = getProviderConfig(settings);
    assert.equal(config.provider, "openai");
    if (config.provider === "openai") {
      assert.equal(config.apiKey, "key");
      assert.equal(config.model, "model");
    }
  });
});
