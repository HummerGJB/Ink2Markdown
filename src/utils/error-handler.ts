import { CancelledError, ProviderError } from "../core/errors";
import type { AppError } from "../core/types";

export function toAppError(error: unknown): AppError {
  if (error instanceof CancelledError) {
    return {
      code: "CANCELLED",
      message: "Ink2Markdown cancelled.",
      recoverable: true,
      timestamp: new Date()
    };
  }

  if (error instanceof ProviderError) {
    const recoverable =
      !error.status || error.status === 429 || error.status >= 500 || isAzureMaxTokensError(error);
    return {
      code: "PROVIDER_ERROR",
      message: formatProviderError(error),
      details: {
        provider: error.provider,
        status: error.status
      },
      recoverable,
      timestamp: new Date()
    };
  }

  if (error instanceof Error) {
    return {
      code: "UNEXPECTED_ERROR",
      message: error.message || "Unexpected error.",
      details: { name: error.name },
      recoverable: false,
      timestamp: new Date()
    };
  }

  return {
    code: "UNKNOWN_ERROR",
    message: "Unexpected error.",
    recoverable: false,
    timestamp: new Date()
  };
}

export function formatError(error: unknown): string {
  return toAppError(error).message;
}

export function isRecoverableError(error: unknown): boolean {
  return toAppError(error).recoverable;
}

export function isAzureMaxTokensError(error: unknown): boolean {
  if (!(error instanceof ProviderError)) {
    return false;
  }

  if (error.provider !== "azure" || error.status !== 400) {
    return false;
  }

  const message = error.message.toLowerCase();
  if (!/(^|[^a-z])max[_\s-]?tokens?([^a-z]|$)/i.test(message)) {
    return false;
  }

  return /higher|increase|could not finish|ran out|too low/i.test(message);
}

function formatProviderError(error: ProviderError): string {
  const status = error.status ? ` (HTTP ${error.status})` : "";
  const label = error.provider === "openai" ? "OpenAI" : "Azure OpenAI";
  return `${label} error${status}: ${error.message}`;
}
