import { App, Modal } from "obsidian";
import { CancellationToken } from "../../core/cancellation";

export class ProgressModal extends Modal {
  private statusEl!: HTMLElement;
  private detailEl!: HTMLElement;
  private etaEl!: HTMLElement;
  private progressEl!: HTMLProgressElement;
  private cancelButton!: HTMLButtonElement;
  private total: number;
  private token: CancellationToken;

  constructor(app: App, total: number, token: CancellationToken) {
    super(app);
    this.total = total;
    this.token = token;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("ink2markdown-progress");

    this.statusEl = contentEl.createEl("div", {
      cls: "ink2markdown-status",
      text: "Starting..."
    });

    this.detailEl = contentEl.createEl("div", {
      cls: "ink2markdown-detail",
      text: "Preparing image processing."
    });

    this.etaEl = contentEl.createEl("div", {
      cls: "ink2markdown-eta",
      text: ""
    });

    this.progressEl = contentEl.createEl("progress", {
      cls: "ink2markdown-progressbar"
    });
    this.progressEl.max = 100;
    this.progressEl.value = 0;

    this.cancelButton = contentEl.createEl("button", {
      text: "Cancel",
      cls: "mod-warning"
    });
    this.cancelButton.setAttribute("aria-label", "Cancel conversion");
    this.cancelButton.addEventListener("click", () => {
      this.cancelButton.disabled = true;
      this.setStatus("Cancelling...");
      this.token.cancel();
    });

    this.cancelButton.focus();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  setStatus(text: string): void {
    this.statusEl.setText(text);
  }

  setDetail(text: string): void {
    this.detailEl.setText(text);
  }

  setEta(secondsRemaining: number | null): void {
    if (secondsRemaining === null || !Number.isFinite(secondsRemaining) || secondsRemaining < 1) {
      this.etaEl.setText("");
      return;
    }

    const rounded = Math.round(secondsRemaining);
    const minutes = Math.floor(rounded / 60);
    const seconds = rounded % 60;
    const suffix = minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
    this.etaEl.setText(`Estimated time remaining: ${suffix}`);
  }

  setProgress(completed: number): void {
    const percent = this.total === 0 ? 0 : Math.round((completed / this.total) * 100);
    this.progressEl.value = percent;
  }
}
