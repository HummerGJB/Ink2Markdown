import {
  DEFAULT_CLEANUP_PROMPT,
  DEFAULT_EXTRACTION_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TITLE_PROMPT
} from "../constants/prompts";
import type {
  AzureProviderConfig,
  Ink2MarkdownSettings,
  OpenAIProviderConfig,
  Prompts,
  ProviderConfig
} from "./types";

// Settings schema version used for migration and export compatibility.
export const SETTINGS_SCHEMA_VERSION = 3;

export const DEFAULT_SETTINGS: Ink2MarkdownSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  provider: "openai",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  extractionPrompt: DEFAULT_EXTRACTION_PROMPT,
  cleanupPrompt: DEFAULT_CLEANUP_PROMPT,
  titlePrompt: DEFAULT_TITLE_PROMPT,
  openaiApiKey: "",
  openaiModel: "gpt-5.2",
  azureEndpoint: "",
  azureDeployment: "",
  azureApiVersion: "",
  azureApiKey: "",
  maxConcurrency: 3,
  maxRequestsPerSecond: 3,
  maxLineRetries: 1,
  maxPageRetries: 1,
  segmentationCacheSize: 20,
  maxImageDimension: 2400,
  imageExportFormat: "png",
  imageJpegQuality: 0.9,
  enableWorkerSegmentation: true,
  enableResponseCache: true,
  responseCacheTtlMs: 600_000,
  responseCacheMaxEntries: 200,
  responseCacheMaxBytesMb: 100,
  memorySampleIntervalMs: 2_000,
  memoryLeakWarnMb: 64,
  logLevel: "info"
};

/**
 * Migrates persisted plugin settings into the current schema shape.
 * Unknown or out-of-range values are clamped to safe defaults.
 */
export function migrateSettings(loaded: unknown): Ink2MarkdownSettings {
  const base = Object.assign({}, DEFAULT_SETTINGS, loaded ?? {}) as Ink2MarkdownSettings;

  base.schemaVersion = SETTINGS_SCHEMA_VERSION;
  base.maxConcurrency = clampInteger(base.maxConcurrency, 1, 8, DEFAULT_SETTINGS.maxConcurrency);
  base.maxRequestsPerSecond = clampInteger(
    base.maxRequestsPerSecond,
    1,
    20,
    DEFAULT_SETTINGS.maxRequestsPerSecond
  );
  base.maxLineRetries = clampInteger(base.maxLineRetries, 0, 4, DEFAULT_SETTINGS.maxLineRetries);
  base.maxPageRetries = clampInteger(base.maxPageRetries, 0, 3, DEFAULT_SETTINGS.maxPageRetries);
  base.segmentationCacheSize = clampInteger(
    base.segmentationCacheSize,
    0,
    100,
    DEFAULT_SETTINGS.segmentationCacheSize
  );
  base.maxImageDimension = clampInteger(
    base.maxImageDimension,
    600,
    5000,
    DEFAULT_SETTINGS.maxImageDimension
  );
  base.imageJpegQuality = clampNumber(base.imageJpegQuality, 0.2, 1, DEFAULT_SETTINGS.imageJpegQuality);
  base.imageExportFormat = base.imageExportFormat === "jpeg" ? "jpeg" : "png";
  base.enableWorkerSegmentation = Boolean(base.enableWorkerSegmentation);
  base.enableResponseCache = base.enableResponseCache !== false;
  base.responseCacheTtlMs = clampInteger(
    base.responseCacheTtlMs,
    10_000,
    86_400_000,
    DEFAULT_SETTINGS.responseCacheTtlMs
  );
  base.responseCacheMaxEntries = clampInteger(
    base.responseCacheMaxEntries,
    10,
    2000,
    DEFAULT_SETTINGS.responseCacheMaxEntries
  );
  base.responseCacheMaxBytesMb = clampInteger(
    base.responseCacheMaxBytesMb,
    10,
    1024,
    DEFAULT_SETTINGS.responseCacheMaxBytesMb
  );
  base.memorySampleIntervalMs = clampInteger(
    base.memorySampleIntervalMs,
    500,
    60_000,
    DEFAULT_SETTINGS.memorySampleIntervalMs
  );
  base.memoryLeakWarnMb = clampInteger(base.memoryLeakWarnMb, 16, 2048, DEFAULT_SETTINGS.memoryLeakWarnMb);
  base.logLevel = normalizeLogLevel(base.logLevel);

  return base;
}

/**
 * Validates provider-specific and runtime settings before operations start.
 * Returns a user-facing message when invalid, otherwise null.
 */
export function validateSettings(settings: Ink2MarkdownSettings): string | null {
  if (settings.provider === "openai") {
    if (!settings.openaiApiKey.trim()) {
      return "Missing OpenAI API key.";
    }
    if (!settings.openaiModel.trim()) {
      return "Missing OpenAI model selection.";
    }
  } else {
    if (!settings.azureEndpoint.trim()) {
      return "Missing Azure endpoint.";
    }
    if (!settings.azureDeployment.trim()) {
      return "Missing Azure deployment name.";
    }
    if (!settings.azureApiVersion.trim()) {
      return "Missing Azure API version.";
    }
    if (!settings.azureApiKey.trim()) {
      return "Missing Azure API key.";
    }
  }

  if (settings.maxConcurrency < 1) {
    return "Max concurrency must be at least 1.";
  }
  if (settings.maxRequestsPerSecond < 1) {
    return "Max requests per second must be at least 1.";
  }
  if (settings.responseCacheTtlMs < 10_000) {
    return "Response cache TTL must be at least 10 seconds.";
  }

  return null;
}

export function buildPrompts(settings: Ink2MarkdownSettings): Prompts {
  return {
    systemPrompt: settings.systemPrompt,
    extractionPrompt: settings.extractionPrompt,
    cleanupPrompt: settings.cleanupPrompt
  };
}

/**
 * Converts flat persisted settings into a discriminated provider config union.
 */
export function getProviderConfig(settings: Ink2MarkdownSettings): ProviderConfig {
  if (settings.provider === "openai") {
    const config: OpenAIProviderConfig = {
      provider: "openai",
      apiKey: settings.openaiApiKey.trim(),
      model: settings.openaiModel.trim()
    };
    return config;
  }

  const config: AzureProviderConfig = {
    provider: "azure",
    endpoint: settings.azureEndpoint.trim(),
    deployment: settings.azureDeployment.trim(),
    apiVersion: settings.azureApiVersion.trim(),
    apiKey: settings.azureApiKey.trim()
  };
  return config;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function normalizeLogLevel(level: unknown): Ink2MarkdownSettings["logLevel"] {
  if (level === "debug" || level === "info" || level === "warn" || level === "error") {
    return level;
  }
  return DEFAULT_SETTINGS.logLevel;
}
