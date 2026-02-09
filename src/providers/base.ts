import type { CancellationToken } from "../core/cancellation";

export interface AIProvider {
  transcribeLine(
    imageDataUrl: string,
    systemPrompt: string,
    prompt: string,
    token: CancellationToken
  ): Promise<string>;
  judgeLine(
    imageDataUrl: string,
    systemPrompt: string,
    prompt: string,
    candidateA: string,
    candidateB: string,
    token: CancellationToken
  ): Promise<string>;
  formatTranscription(
    markdown: string,
    systemPrompt: string,
    prompt: string,
    token: CancellationToken
  ): Promise<string>;
  generateTitle(markdown: string, prompt: string, token: CancellationToken): Promise<string>;
  testConnection(token: CancellationToken): Promise<void>;
}

export interface ProviderRuntimeOptions {
  maxRequestsPerSecond: number;
  httpMaxAttempts?: number;
  enableResponseCache: boolean;
  responseCacheTtlMs: number;
  responseCacheMaxEntries: number;
  responseCacheMaxBytes: number;
}
