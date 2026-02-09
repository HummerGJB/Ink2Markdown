export class CancellationToken {
  cancelled = false;
  private controllers = new Set<AbortController>();

  cancel(): void {
    this.cancelled = true;
    for (const controller of this.controllers) {
      controller.abort();
    }
    this.controllers.clear();
  }

  register(controller: AbortController): void {
    if (this.cancelled) {
      controller.abort();
      return;
    }
    this.controllers.add(controller);
  }

  unregister(controller: AbortController): void {
    this.controllers.delete(controller);
  }
}
