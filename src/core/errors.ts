import type { ProviderType } from "./types";

export class CancelledError extends Error {
  constructor() {
    super("Ink2Markdown cancelled");
    this.name = "CancelledError";
  }
}

export class ProviderError extends Error {
  provider: ProviderType;
  status?: number;

  constructor(provider: ProviderType, message: string, status?: number) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
  }
}
