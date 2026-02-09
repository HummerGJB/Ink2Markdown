import type { CancellationToken } from "../core/cancellation";
import type { AzureProviderConfig } from "../core/types";
import type { AIProvider, ProviderRuntimeOptions } from "./base";
import { fetchWithRetry } from "./http";
import { extractAzureOutputText } from "./parsers";
import { RateLimiter } from "./rate-limiter";

export class AzureOpenAIProvider implements AIProvider {
  private readonly endpoint: string;
  private readonly deployment: string;
  private readonly apiVersion: string;
  private readonly apiKey: string;
  private readonly rateLimiter: RateLimiter;
  private readonly options: ProviderRuntimeOptions;

  constructor(config: AzureProviderConfig, options: ProviderRuntimeOptions) {
    this.endpoint = config.endpoint.trim().replace(/\/+$/, "");
    this.deployment = config.deployment.trim();
    this.apiVersion = config.apiVersion.trim();
    this.apiKey = config.apiKey.trim();
    this.rateLimiter = new RateLimiter(options.maxRequestsPerSecond);
    this.options = options;
  }

  async transcribeLine(
    imageDataUrl: string,
    systemPrompt: string,
    prompt: string,
    token: CancellationToken
  ): Promise<string> {
    const response = await this.request(
      {
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: imageDataUrl } }
            ]
          }
        ]
      },
      token
    );

    return extractAzureOutputText(response);
  }

  async judgeLine(
    imageDataUrl: string,
    systemPrompt: string,
    prompt: string,
    candidateA: string,
    candidateB: string,
    token: CancellationToken
  ): Promise<string> {
    const response = await this.request(
      {
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "text", text: `Candidate A:\n${candidateA}` },
              { type: "text", text: `Candidate B:\n${candidateB}` },
              { type: "image_url", image_url: { url: imageDataUrl } }
            ]
          }
        ]
      },
      token
    );

    return extractAzureOutputText(response);
  }

  async formatTranscription(
    markdown: string,
    systemPrompt: string,
    prompt: string,
    token: CancellationToken
  ): Promise<string> {
    const response = await this.request(
      {
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "text", text: markdown }
            ]
          }
        ]
      },
      token
    );

    return extractAzureOutputText(response);
  }

  async testConnection(token: CancellationToken): Promise<void> {
    await this.request(
      {
        messages: [{ role: "user", content: "ping" }]
      },
      token
    );
  }

  async generateTitle(markdown: string, prompt: string, token: CancellationToken): Promise<string> {
    const response = await this.request(
      {
        messages: [
          { role: "system", content: prompt },
          {
            role: "user",
            content: [{ type: "text", text: markdown }]
          }
        ]
      },
      token
    );

    return extractAzureOutputText(response);
  }

  private request(body: unknown, token: CancellationToken): Promise<unknown> {
    return fetchWithRetry(
      this.buildUrl(),
      {
        method: "POST",
        headers: {
          "api-key": this.apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      },
      token,
      "azure",
      {
        maxAttempts: this.options.httpMaxAttempts ?? 2,
        rateLimiter: this.rateLimiter,
        useCache: this.options.enableResponseCache,
        cacheTtlMs: this.options.responseCacheTtlMs,
        cacheMaxEntries: this.options.responseCacheMaxEntries,
        cacheMaxBytes: this.options.responseCacheMaxBytes
      }
    );
  }

  private buildUrl(): string {
    return `${this.endpoint}/openai/deployments/${encodeURIComponent(
      this.deployment
    )}/chat/completions?api-version=${encodeURIComponent(this.apiVersion)}`;
  }
}
