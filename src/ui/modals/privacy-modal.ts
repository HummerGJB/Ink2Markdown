import { App, Modal } from "obsidian";

export class PrivacyModal extends Modal {
  private resolve: (accepted: boolean) => void;
  private resolved = false;

  constructor(app: App, resolve: (accepted: boolean) => void) {
    super(app);
    this.resolve = resolve;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("ink2markdown-disclosure");

    contentEl.createEl("h2", { text: "Ink2Markdown Privacy Disclosure" });
    contentEl.createEl("p", {
      text:
        "Ink2Markdown sends your embedded note images to the configured AI provider for transcription."
    });
    contentEl.createEl("p", {
      text: "Do not use with sensitive/confidential information unless you accept this."
    });

    const buttonRow = contentEl.createEl("div", { cls: "ink2markdown-buttons" });

    const acceptButton = buttonRow.createEl("button", {
      text: "I Understand",
      cls: "mod-cta"
    });
    acceptButton.setAttribute("aria-label", "Accept privacy disclosure");

    const cancelButton = buttonRow.createEl("button", { text: "Cancel" });
    cancelButton.setAttribute("aria-label", "Cancel privacy disclosure");

    acceptButton.addEventListener("click", () => this.finish(true));
    cancelButton.addEventListener("click", () => this.finish(false));

    acceptButton.focus();
  }

  onClose(): void {
    if (!this.resolved) {
      this.finish(false);
    }
  }

  private finish(accepted: boolean): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.resolve(accepted);
    this.close();
  }
}
