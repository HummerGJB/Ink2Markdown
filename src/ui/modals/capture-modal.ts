import { App, Modal, Notice } from "obsidian";
import type { CaptureResult } from "../../core/types";

export class CaptureModal extends Modal {
  private resolve: (result: CaptureResult) => void;
  private onCapture: (file: File, index: number) => Promise<void>;
  private resolved = false;
  private captured = 0;
  private processing = false;
  private autoTitle = false;
  private statusEl!: HTMLElement;
  private takeButton!: HTMLButtonElement;
  private doneButton!: HTMLButtonElement;
  private cancelButton!: HTMLButtonElement;

  constructor(
    app: App,
    onCapture: (file: File, index: number) => Promise<void>,
    resolve: (result: CaptureResult) => void
  ) {
    super(app);
    this.onCapture = onCapture;
    this.resolve = resolve;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("ink2markdown-capture");

    contentEl.createEl("h2", { text: "Capture note pages" });
    contentEl.createEl("p", {
      text: "Photos will be added to the bottom of the current note."
    });

    this.statusEl = contentEl.createEl("div", {
      cls: "ink2markdown-capture-status",
      text: "No photos captured yet."
    });

    const optionRow = contentEl.createEl("label", {
      cls: "ink2markdown-capture-option"
    });
    const checkbox = optionRow.createEl("input", { type: "checkbox" });
    optionRow.createSpan({ text: "Auto-generate title with AI" });
    checkbox.addEventListener("change", () => {
      this.autoTitle = checkbox.checked;
    });

    const buttonRow = contentEl.createEl("div", { cls: "ink2markdown-buttons" });
    this.cancelButton = buttonRow.createEl("button", { text: "Cancel" });
    this.cancelButton.setAttribute("aria-label", "Cancel capture workflow");

    this.takeButton = buttonRow.createEl("button", {
      text: "Take photo",
      cls: "mod-cta"
    });
    this.takeButton.setAttribute("aria-label", "Take a photo");

    this.doneButton = buttonRow.createEl("button", { text: "Done" });
    this.doneButton.setAttribute("aria-label", "Finish capture workflow");

    this.takeButton.addEventListener("click", () => {
      if (!this.processing) {
        this.startCapture();
      }
    });

    this.doneButton.addEventListener("click", () => {
      this.finish("done");
    });

    this.cancelButton.addEventListener("click", () => {
      this.finish("cancel");
    });

    this.doneButton.disabled = true;
    this.takeButton.focus();

    window.setTimeout(() => {
      if (!this.processing) {
        this.startCapture();
      }
    }, 0);
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) {
      this.finish("cancel");
    }
  }

  private startCapture(): void {
    const inputEl = this.contentEl.createEl("input") as HTMLInputElement;
    inputEl.type = "file";
    inputEl.accept = "image/*";
    inputEl.setAttribute("capture", "environment");
    inputEl.style.display = "none";

    inputEl.addEventListener("change", () => {
      void this.handleSelection(inputEl);
    });

    try {
      inputEl.click();
    } catch {
      inputEl.remove();
    }
  }

  private async handleSelection(inputEl: HTMLInputElement): Promise<void> {
    if (this.processing) {
      inputEl.remove();
      return;
    }

    const file = inputEl.files?.[0];
    inputEl.value = "";
    inputEl.remove();

    if (!file) {
      return;
    }

    this.processing = true;
    this.setButtonsDisabled(true);
    this.setStatus("Saving photo...");

    try {
      await this.onCapture(file, this.captured + 1);
      this.captured += 1;
      this.doneButton.disabled = false;
      this.setStatus(`${this.captured} photo${this.captured === 1 ? "" : "s"} captured.`);
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : "Failed to save photo.";
      new Notice(message);
      this.setStatus("Could not save that photo.");
    } finally {
      this.processing = false;
      this.setButtonsDisabled(false);
    }
  }

  private setButtonsDisabled(disabled: boolean): void {
    this.takeButton.disabled = disabled;
    this.doneButton.disabled = disabled || this.captured === 0;
    this.cancelButton.disabled = disabled;
  }

  private setStatus(text: string): void {
    this.statusEl.setText(text);
  }

  private finish(status: CaptureResult["status"]): void {
    if (this.resolved) {
      return;
    }

    this.resolved = true;
    this.resolve({ status, count: this.captured, autoTitle: this.autoTitle });
    this.close();
  }
}
