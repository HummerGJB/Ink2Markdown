import type { Ink2MarkdownSettings } from "../core/types";
import { getProviderConfig } from "../core/settings";
import type { AIProvider, ProviderRuntimeOptions } from "./base";
import { AzureOpenAIProvider } from "./azure";
import { OpenAIProvider } from "./openai";

export function createProvider(settings: Ink2MarkdownSettings): AIProvider {
  const config = getProviderConfig(settings);
  const options: ProviderRuntimeOptions = {
    maxRequestsPerSecond: settings.maxRequestsPerSecond,
    enableResponseCache: settings.enableResponseCache,
    responseCacheTtlMs: settings.responseCacheTtlMs,
    responseCacheMaxEntries: settings.responseCacheMaxEntries,
    responseCacheMaxBytes: settings.responseCacheMaxBytesMb * 1024 * 1024
  };

  if (config.provider === "openai") {
    return new OpenAIProvider(config, options);
  }

  return new AzureOpenAIProvider(config, options);
}
