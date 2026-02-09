import { requestUrl } from "obsidian";
import { REQUEST_TIMEOUT_MS } from "../constants/config";
import { CancelledError, ProviderError } from "../core/errors";
import type { CancellationToken } from "../core/cancellation";
import type { ProviderType } from "../core/types";
import type { RateLimiter } from "./rate-limiter";

interface CachedResponse {
  value: unknown;
  expiresAt: number;
  approxBytes: number;
}

const responseCache = new Map<string, CachedResponse>();
const inFlightRequests = new Map<string, Promise<unknown>>();
let cacheBytesInUse = 0;

export interface FetchOptions {
  maxAttempts?: number;
  rateLimiter?: RateLimiter;
  useCache?: boolean;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
  cacheMaxBytes?: number;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  token: CancellationToken,
  provider: ProviderType,
  options?: FetchOptions
): Promise<unknown> {
  const requestKey = buildRequestKey(url, init, provider);
  const useCache = options?.useCache === true;
  const cacheTtlMs = options?.cacheTtlMs ?? 0;
  const cacheMaxEntries = options?.cacheMaxEntries ?? 200;
  const cacheMaxBytes = options?.cacheMaxBytes ?? 50 * 1024 * 1024;

  if (useCache) {
    const cached = readCache(requestKey);
    if (cached !== undefined) {
      return cached;
    }
  }

  const existing = inFlightRequests.get(requestKey);
  if (existing) {
    return existing.then((value) => cloneResponse(value));
  }

  const task = executeWithRetry(
    url,
    init,
    token,
    provider,
    options?.maxAttempts ?? 2,
    options?.rateLimiter
  )
    .then((value) => {
      if (useCache && cacheTtlMs > 0) {
        writeCache(requestKey, value, cacheTtlMs, cacheMaxEntries, cacheMaxBytes);
      }
      return value;
    })
    .finally(() => {
      inFlightRequests.delete(requestKey);
    });

  inFlightRequests.set(requestKey, task);
  return task.then((value) => cloneResponse(value));
}

export function clearResponseCache(): void {
  responseCache.clear();
  cacheBytesInUse = 0;
}

async function executeWithRetry(
  url: string,
  init: RequestInit,
  token: CancellationToken,
  provider: ProviderType,
  maxAttempts: number,
  rateLimiter?: RateLimiter
): Promise<unknown> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (rateLimiter) {
        await rateLimiter.waitTurn();
      }
      return await fetchJson(url, init, token, provider);
    } catch (error) {
      lastError = error;
      if (token.cancelled) {
        throw new CancelledError();
      }
      if (error instanceof ProviderError) {
        if (!isRetryableStatus(error.status) || attempt === maxAttempts) {
          throw error;
        }
        await delay(attempt * 400);
      } else if (attempt === maxAttempts) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function fetchJson(
  url: string,
  init: RequestInit,
  token: CancellationToken,
  provider: ProviderType
): Promise<unknown> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    if (token.cancelled) {
      throw new CancelledError();
    }

    const headers = normalizeHeaders(init.headers);
    if (!headers.Connection) {
      headers.Connection = "keep-alive";
    }
    const body = typeof init.body === "string" ? init.body : init.body ? String(init.body) : undefined;

    const response = await Promise.race([
      requestUrl({
        url,
        method: init.method ?? "GET",
        headers,
        body,
        throw: false
      }),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new ProviderError(provider, "Request timed out."));
        }, REQUEST_TIMEOUT_MS);
      })
    ]);

    if (token.cancelled) {
      throw new CancelledError();
    }

    if (response.status < 200 || response.status >= 300) {
      const message = extractErrorMessage(response.json) ?? extractErrorMessage(parseJson(response.text));
      throw new ProviderError(
        provider,
        message ?? `${provider.toUpperCase()} error (${response.status}).`,
        response.status
      );
    }

    return response.json ?? parseJson(response.text);
  } catch (error) {
    if (token.cancelled) {
      throw new CancelledError();
    }
    if (error instanceof ProviderError) {
      throw error;
    }
    if (error instanceof Error && /timed out|timeout/i.test(error.message)) {
      throw new ProviderError(provider, "Request timed out.");
    }
    throw new ProviderError(provider, "Network error while contacting provider.");
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function parseJson(text: string | null | undefined): unknown | null {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function extractErrorMessage(data: unknown): string | null {
  const parsed = asRecord(data);
  if (parsed.error && typeof asRecord(parsed.error).message === "string") {
    return asRecord(parsed.error).message as string;
  }
  return typeof parsed.message === "string" ? parsed.message : null;
}

function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) {
    return {};
  }
  if (headers instanceof Headers) {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers as Record<string, string>;
}

function buildRequestKey(url: string, init: RequestInit, provider: ProviderType): string {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = normalizeHeaders(init.headers);
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${redactHeaderValue(name, headers[name])}`)
    .join("|");
  const body = typeof init.body === "string" ? init.body : init.body ? String(init.body) : "";
  return `${provider}|${method}|${url}|${canonicalHeaders}|${body}`;
}

function redactHeaderValue(name: string, value: string): string {
  const lowered = name.toLowerCase();
  if (lowered === "authorization" || lowered === "api-key") {
    return `<redacted:${value.length}>`;
  }
  return value;
}

function readCache(key: string): unknown | undefined {
  const entry = responseCache.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    responseCache.delete(key);
    cacheBytesInUse -= entry.approxBytes;
    return undefined;
  }

  responseCache.delete(key);
  responseCache.set(key, entry);
  return cloneResponse(entry.value);
}

function writeCache(
  key: string,
  value: unknown,
  ttlMs: number,
  maxEntries: number,
  maxBytes: number
): void {
  const cloned = cloneResponse(value);
  const approxBytes = approximateSize(cloned);

  const existing = responseCache.get(key);
  if (existing) {
    cacheBytesInUse -= existing.approxBytes;
    responseCache.delete(key);
  }

  responseCache.set(key, {
    value: cloned,
    expiresAt: Date.now() + ttlMs,
    approxBytes
  });
  cacheBytesInUse += approxBytes;

  while (responseCache.size > maxEntries || cacheBytesInUse > maxBytes) {
    const oldestKey = responseCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    const removed = responseCache.get(oldestKey);
    responseCache.delete(oldestKey);
    if (removed) {
      cacheBytesInUse -= removed.approxBytes;
    }
  }
}

function approximateSize(value: unknown): number {
  try {
    return JSON.stringify(value).length * 2;
  } catch {
    return 8 * 1024;
  }
}

function cloneResponse<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRetryableStatus(status?: number): boolean {
  if (!status) {
    return true;
  }
  return status === 429 || status >= 500;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
