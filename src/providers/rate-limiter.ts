export class RateLimiter {
  private readonly minIntervalMs: number;
  private lastRun = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(requestsPerSecond: number) {
    this.minIntervalMs = Math.max(1, Math.floor(1000 / Math.max(1, requestsPerSecond)));
  }

  waitTurn(): Promise<void> {
    this.queue = this.queue.then(async () => {
      const now = Date.now();
      const elapsed = now - this.lastRun;
      const waitMs = Math.max(0, this.minIntervalMs - elapsed);
      if (waitMs > 0) {
        await delay(waitMs);
      }
      this.lastRun = Date.now();
    });

    return this.queue;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
