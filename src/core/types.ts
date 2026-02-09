export type ProviderType = "openai" | "azure";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Ink2MarkdownSettings {
  schemaVersion: number;
  provider: ProviderType;
  systemPrompt: string;
  extractionPrompt: string;
  cleanupPrompt: string;
  titlePrompt: string;
  openaiApiKey: string;
  openaiModel: string;
  azureEndpoint: string;
  azureDeployment: string;
  azureApiVersion: string;
  azureApiKey: string;
  privacyAcceptedAt?: number;
  maxConcurrency: number;
  maxRequestsPerSecond: number;
  maxLineRetries: number;
  maxPageRetries: number;
  segmentationCacheSize: number;
  maxImageDimension: number;
  imageExportFormat: "png" | "jpeg";
  imageJpegQuality: number;
  enableWorkerSegmentation: boolean;
  enableResponseCache: boolean;
  responseCacheTtlMs: number;
  responseCacheMaxEntries: number;
  responseCacheMaxBytesMb: number;
  memorySampleIntervalMs: number;
  memoryLeakWarnMb: number;
  logLevel: LogLevel;
}

export interface OpenAIProviderConfig {
  provider: "openai";
  apiKey: string;
  model: string;
}

export interface AzureProviderConfig {
  provider: "azure";
  endpoint: string;
  deployment: string;
  apiVersion: string;
  apiKey: string;
}

export type ProviderConfig = OpenAIProviderConfig | AzureProviderConfig;

export interface Prompts {
  systemPrompt: string;
  extractionPrompt: string;
  cleanupPrompt: string;
}

export interface CaptureResult {
  status: "done" | "cancel";
  count: number;
  autoTitle: boolean;
}

export interface ImageEmbed {
  linkpath: string;
}

export interface LineSlice {
  imageDataUrl: string;
  top: number;
  bottom: number;
}

export interface LineTranscription {
  text: string;
  confidence: number;
  unresolved: boolean;
}

export interface AppError {
  code: string;
  message: string;
  details?: unknown;
  recoverable: boolean;
  timestamp: Date;
}

export type PluginStatus = "idle" | "capturing" | "converting" | "testing";

export interface PluginState {
  status: PluginStatus;
  startedAt?: number;
  totalImages: number;
  completedImages: number;
  cancelled: boolean;
  lastError?: AppError;
}

export interface SettingsExport {
  version: number;
  exportedAt: string;
  settings: Ink2MarkdownSettings;
}

export interface MemorySample {
  timestamp: number;
  heapUsed: number;
  heapTotal?: number;
  rss?: number;
  label?: string;
}

export interface MemoryReport {
  label: string;
  sampleCount: number;
  durationMs: number;
  startHeapUsed: number;
  endHeapUsed: number;
  peakHeapUsed: number;
  growthBytes: number;
  growthPercent: number;
  leakSuspected: boolean;
}
