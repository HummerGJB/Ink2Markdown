import type { CancellationToken } from "../core/cancellation";
import type { OpenAIProviderConfig } from "../core/types";
import type { AIProvider, ProviderRuntimeOptions } from "./base";
import { fetchWithRetry } from "./http";
import { extractOpenAIOutputText } from "./parsers";
import { RateLimiter } from "./rate-limiter";

export class OpenAIProvider implements AIProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly rateLimiter: RateLimiter;
  private readonly options: ProviderRuntimeOptions;

  constructor(config: OpenAIProviderConfig, options: ProviderRuntimeOptions) {
    this.apiKey = config.apiKey.trim();
    this.model = config.model.trim();
    this.rateLimiter = new RateLimiter(options.maxRequestsPerSecond);
    this.options = options;
  }

  async transcribeLine(
    imageDataUrl: string,
    systemPrompt: string,
    prompt: string,
    token: CancellationToken
  ): Promise<string> {
    const body = {
      model: this.model,
      instructions: systemPrompt,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: imageDataUrl }
          ]
        }
      ]
    };

    const response = await this.request("https://api.openai.com/v1/responses", body, token);
    return extractOpenAIOutputText(response);
  }

  async judgeLine(
    imageDataUrl: string,
    systemPrompt: string,
    prompt: string,
    candidateA: string,
    candidateB: string,
    token: CancellationToken
  ): Promise<string> {
    const body = {
      model: this.model,
      instructions: systemPrompt,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_text", text: `Candidate A:\n${candidateA}` },
            { type: "input_text", text: `Candidate B:\n${candidateB}` },
            { type: "input_image", image_url: imageDataUrl }
          ]
        }
      ]
    };

    const response = await this.request("https://api.openai.com/v1/responses", body, token);
    return extractOpenAIOutputText(response);
  }

  async formatTranscription(
    markdown: string,
    systemPrompt: string,
    prompt: string,
    token: CancellationToken
  ): Promise<string> {
    const body = {
      model: this.model,
      instructions: systemPrompt,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_text", text: markdown }
          ]
        }
      ]
    };

    const response = await this.request("https://api.openai.com/v1/responses", body, token);
    return extractOpenAIOutputText(response);
  }

  async testConnection(token: CancellationToken): Promise<void> {
    await this.request(
      "https://api.openai.com/v1/responses",
      {
        model: this.model,
        input: "ping"
      },
      token
    );
  }

  async generateTitle(markdown: string, prompt: string, token: CancellationToken): Promise<string> {
    const response = await this.request(
      "https://api.openai.com/v1/responses",
      {
        model: this.model,
        instructions: prompt,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: markdown }]
          }
        ]
      },
      token
    );

    return extractOpenAIOutputText(response);
  }

  private request(url: string, body: unknown, token: CancellationToken): Promise<unknown> {
    return fetchWithRetry(
      url,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      },
      token,
      "openai",
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
}
