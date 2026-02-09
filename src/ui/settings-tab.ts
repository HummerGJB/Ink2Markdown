import { App, PluginSettingTab, Setting } from "obsidian";
import {
  DEFAULT_CLEANUP_PROMPT,
  DEFAULT_EXTRACTION_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_TITLE_PROMPT,
  OPENAI_MODELS
} from "../constants/prompts";
import { validateSettings } from "../core/settings";
import type { ProviderType } from "../core/types";
import type Ink2MarkdownPlugin from "../core/plugin";
import { PrivacyModal } from "./modals/privacy-modal";

export class Ink2MarkdownSettingTab extends PluginSettingTab {
  private plugin: Ink2MarkdownPlugin;

  constructor(app: App, plugin: Ink2MarkdownPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Ink2Markdown Settings" });

    new Setting(containerEl)
      .setName("Provider")
      .setDesc("Choose OpenAI or Azure OpenAI.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("openai", "OpenAI")
          .addOption("azure", "Azure OpenAI")
          .setValue(this.plugin.settings.provider)
          .onChange(async (value) => {
            this.plugin.settings.provider = value as ProviderType;
            await this.plugin.saveSettings();
            this.display();
          });
      });

    if (this.plugin.settings.provider === "openai") {
      new Setting(containerEl)
        .setName("OpenAI API key")
        .setDesc("Stored locally in plaintext as requested.")
        .addText((text) => {
          text.inputEl.type = "password";
          text
            .setPlaceholder("sk-...")
            .setValue(this.plugin.settings.openaiApiKey)
            .onChange(async (value) => {
              this.plugin.settings.openaiApiKey = value.trim();
              await this.plugin.saveSettings();
              this.showValidation(containerEl);
            });
        });

      new Setting(containerEl)
        .setName("OpenAI model")
        .setDesc("GPT-5 family models that support image input.")
        .addDropdown((dropdown) => {
          for (const model of OPENAI_MODELS) {
            dropdown.addOption(model, model);
          }
          dropdown.setValue(this.plugin.settings.openaiModel).onChange(async (value) => {
            this.plugin.settings.openaiModel = value;
            await this.plugin.saveSettings();
            this.showValidation(containerEl);
          });
        });
    }

    if (this.plugin.settings.provider === "azure") {
      new Setting(containerEl)
        .setName("Azure endpoint")
        .setDesc("Example: https://{resource}.openai.azure.com")
        .addText((text) => {
          text
            .setPlaceholder("https://example.openai.azure.com")
            .setValue(this.plugin.settings.azureEndpoint)
            .onChange(async (value) => {
              this.plugin.settings.azureEndpoint = value.trim();
              await this.plugin.saveSettings();
              this.showValidation(containerEl);
            });
        });

      new Setting(containerEl)
        .setName("Azure deployment name")
        .setDesc("Vision-enabled deployment name")
        .addText((text) => {
          text
            .setPlaceholder("deployment-name")
            .setValue(this.plugin.settings.azureDeployment)
            .onChange(async (value) => {
              this.plugin.settings.azureDeployment = value.trim();
              await this.plugin.saveSettings();
              this.showValidation(containerEl);
            });
        });

      new Setting(containerEl)
        .setName("Azure API version")
        .setDesc("Example: 2024-02-15-preview")
        .addText((text) => {
          text
            .setPlaceholder("2024-02-15-preview")
            .setValue(this.plugin.settings.azureApiVersion)
            .onChange(async (value) => {
              this.plugin.settings.azureApiVersion = value.trim();
              await this.plugin.saveSettings();
              this.showValidation(containerEl);
            });
        });

      new Setting(containerEl)
        .setName("Azure API key")
        .setDesc("Stored locally in plaintext as requested.")
        .addText((text) => {
          text.inputEl.type = "password";
          text
            .setPlaceholder("azure-key")
            .setValue(this.plugin.settings.azureApiKey)
            .onChange(async (value) => {
              this.plugin.settings.azureApiKey = value.trim();
              await this.plugin.saveSettings();
              this.showValidation(containerEl);
            });
        });
    }

    new Setting(containerEl)
      .setName("Test connection")
      .setDesc("Validate your current provider credentials and settings.")
      .addButton((button) => {
        button.setButtonText("Test connection").onClick(async () => {
          button.setDisabled(true);
          button.setButtonText("Testing...");
          await this.plugin.testConnection();
          button.setButtonText("Test connection");
          button.setDisabled(false);
        });
      });

    containerEl.createEl("h3", { text: "Runtime" });

    addNumericSetting(containerEl, "Max concurrent images", "Pages processed at once.", this.plugin.settings.maxConcurrency, 1, 8, async (value) => {
      this.plugin.settings.maxConcurrency = value;
      await this.plugin.saveSettings();
    });

    addNumericSetting(containerEl, "Max requests per second", "Provider request rate limiter.", this.plugin.settings.maxRequestsPerSecond, 1, 20, async (value) => {
      this.plugin.settings.maxRequestsPerSecond = value;
      await this.plugin.saveSettings();
    });

    addNumericSetting(containerEl, "Line retries", "Retries for recoverable line failures.", this.plugin.settings.maxLineRetries, 0, 4, async (value) => {
      this.plugin.settings.maxLineRetries = value;
      await this.plugin.saveSettings();
    });

    addNumericSetting(containerEl, "Page retries", "Retries for recoverable page failures.", this.plugin.settings.maxPageRetries, 0, 3, async (value) => {
      this.plugin.settings.maxPageRetries = value;
      await this.plugin.saveSettings();
    });

    addNumericSetting(containerEl, "Segmentation cache size", "Number of segmented images held in memory.", this.plugin.settings.segmentationCacheSize, 0, 100, async (value) => {
      this.plugin.settings.segmentationCacheSize = value;
      await this.plugin.saveSettings();
    });

    addNumericSetting(containerEl, "Max image dimension", "Downscale long edge before segmentation (px).", this.plugin.settings.maxImageDimension, 600, 5000, async (value) => {
      this.plugin.settings.maxImageDimension = value;
      await this.plugin.saveSettings();
    });

    addNumericSetting(containerEl, "JPEG quality (%)", "Used when image export format is JPEG.", Math.round(this.plugin.settings.imageJpegQuality * 100), 20, 100, async (value) => {
      this.plugin.settings.imageJpegQuality = value / 100;
      await this.plugin.saveSettings();
    });

    new Setting(containerEl)
      .setName("Image export format")
      .setDesc("Line-slice image format sent to provider.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("png", "PNG")
          .addOption("jpeg", "JPEG")
          .setValue(this.plugin.settings.imageExportFormat)
          .onChange(async (value) => {
            this.plugin.settings.imageExportFormat = value === "jpeg" ? "jpeg" : "png";
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Use worker segmentation")
      .setDesc("Run heavy line-segmentation analysis in a Web Worker.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.enableWorkerSegmentation)
          .onChange(async (value) => {
            this.plugin.settings.enableWorkerSegmentation = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Enable response cache")
      .setDesc("Cache provider responses and coalesce identical in-flight requests.")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.enableResponseCache)
          .onChange(async (value) => {
            this.plugin.settings.enableResponseCache = value;
            await this.plugin.saveSettings();
          });
      });

    addNumericSetting(containerEl, "Response cache TTL (sec)", "How long cached provider responses remain valid.", Math.round(this.plugin.settings.responseCacheTtlMs / 1000), 10, 86400, async (value) => {
      this.plugin.settings.responseCacheTtlMs = value * 1000;
      await this.plugin.saveSettings();
    });

    addNumericSetting(containerEl, "Response cache max entries", "Maximum number of cached responses.", this.plugin.settings.responseCacheMaxEntries, 10, 2000, async (value) => {
      this.plugin.settings.responseCacheMaxEntries = value;
      await this.plugin.saveSettings();
    });

    addNumericSetting(containerEl, "Response cache max MB", "Approximate memory cap for cached responses.", this.plugin.settings.responseCacheMaxBytesMb, 10, 1024, async (value) => {
      this.plugin.settings.responseCacheMaxBytesMb = value;
      await this.plugin.saveSettings();
    });

    addNumericSetting(containerEl, "Memory sample interval (ms)", "Sampling interval for memory monitor.", this.plugin.settings.memorySampleIntervalMs, 500, 60000, async (value) => {
      this.plugin.settings.memorySampleIntervalMs = value;
      await this.plugin.saveSettings();
    });

    addNumericSetting(containerEl, "Leak warning threshold (MB)", "Warn when heap growth exceeds this threshold.", this.plugin.settings.memoryLeakWarnMb, 16, 2048, async (value) => {
      this.plugin.settings.memoryLeakWarnMb = value;
      await this.plugin.saveSettings();
    });

    new Setting(containerEl)
      .setName("Log level")
      .setDesc("Controls plugin log verbosity.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("debug", "debug")
          .addOption("info", "info")
          .addOption("warn", "warn")
          .addOption("error", "error")
          .setValue(this.plugin.settings.logLevel)
          .onChange(async (value) => {
            this.plugin.settings.logLevel =
              value === "debug" || value === "warn" || value === "error" ? value : "info";
            await this.plugin.saveSettings();
          });
      });

    containerEl.createEl("h3", { text: "Prompts" });

    addPromptSetting(containerEl, "System prompt", "Shared system prompt for extraction and cleanup.", this.plugin.settings.systemPrompt, async (value) => {
      this.plugin.settings.systemPrompt = value;
      await this.plugin.saveSettings();
    }, async () => {
      this.plugin.settings.systemPrompt = DEFAULT_SYSTEM_PROMPT;
      await this.plugin.saveSettings();
      this.display();
    }, "Reset System Prompt");

    addPromptSetting(containerEl, "Extraction prompt", "Prompt used for per-page transcription.", this.plugin.settings.extractionPrompt, async (value) => {
      this.plugin.settings.extractionPrompt = value;
      await this.plugin.saveSettings();
    }, async () => {
      this.plugin.settings.extractionPrompt = DEFAULT_EXTRACTION_PROMPT;
      await this.plugin.saveSettings();
      this.display();
    }, "Reset Extraction Prompt");

    addPromptSetting(containerEl, "Cleanup prompt", "Prompt used for final formatting cleanup.", this.plugin.settings.cleanupPrompt, async (value) => {
      this.plugin.settings.cleanupPrompt = value;
      await this.plugin.saveSettings();
    }, async () => {
      this.plugin.settings.cleanupPrompt = DEFAULT_CLEANUP_PROMPT;
      await this.plugin.saveSettings();
      this.display();
    }, "Reset Cleanup Prompt");

    addPromptSetting(containerEl, "Title prompt", "Prompt used to generate a short title from the cleaned note.", this.plugin.settings.titlePrompt, async (value) => {
      this.plugin.settings.titlePrompt = value;
      await this.plugin.saveSettings();
    }, async () => {
      this.plugin.settings.titlePrompt = DEFAULT_TITLE_PROMPT;
      await this.plugin.saveSettings();
      this.display();
    }, "Reset Title Prompt");

    containerEl.createEl("h3", { text: "Settings & Logs" });

    new Setting(containerEl)
      .setName("Export settings")
      .setDesc("Creates a JSON file in your vault (API keys omitted).")
      .addButton((button) => {
        button.setButtonText("Export").onClick(async () => {
          await this.plugin.exportSettingsToVault();
        });
      });

    new Setting(containerEl)
      .setName("Import settings")
      .setDesc("Open a JSON file in the editor, then import from active file.")
      .addButton((button) => {
        button.setButtonText("Import active file").onClick(async () => {
          await this.plugin.importSettingsFromActiveFile();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("Export logs")
      .setDesc("Writes structured plugin logs to a vault file.")
      .addButton((button) => {
        button.setButtonText("Export logs").onClick(async () => {
          await this.plugin.exportLogsToVault();
        });
      });

    containerEl.createEl("h3", { text: "Privacy disclosure" });

    const acceptedAt = this.plugin.settings.privacyAcceptedAt;
    const statusText = acceptedAt
      ? `Accepted on ${new Date(acceptedAt).toLocaleString()}`
      : "Not accepted";

    new Setting(containerEl)
      .setName("Disclosure status")
      .setDesc(statusText)
      .addButton((button) => {
        button.setButtonText("Review disclosure").onClick(async () => {
          const accepted = await new Promise<boolean>((resolve) => {
            const modal = new PrivacyModal(this.app, resolve);
            modal.open();
          });
          if (accepted && !this.plugin.settings.privacyAcceptedAt) {
            this.plugin.settings.privacyAcceptedAt = Date.now();
            await this.plugin.saveSettings();
            this.display();
          }
        });
      });

    this.showValidation(containerEl);
  }

  private showValidation(containerEl: HTMLElement): void {
    const id = "ink2markdown-validation";
    containerEl.querySelector(`#${id}`)?.remove();

    const message = validateSettings(this.plugin.settings);
    const el = containerEl.createEl("div", { attr: { id } });
    if (message) {
      el.setText(`Configuration warning: ${message}`);
      el.addClass("mod-warning");
      return;
    }

    el.setText("Configuration looks valid.");
  }
}

function addPromptSetting(
  containerEl: HTMLElement,
  name: string,
  description: string,
  value: string,
  onChange: (value: string) => Promise<void>,
  onReset: () => Promise<void>,
  resetLabel: string
): void {
  const setting = new Setting(containerEl).setName(name).setDesc(description);

  setting.addTextArea((text) => {
    text.setValue(value).onChange(async (newValue) => {
      await onChange(newValue);
    });
    text.inputEl.rows = 6;
  });

  setting.addButton((button) => {
    button.setButtonText(resetLabel).onClick(async () => {
      await onReset();
    });
  });
}

function addNumericSetting(
  containerEl: HTMLElement,
  name: string,
  description: string,
  value: number,
  min: number,
  max: number,
  onChange: (value: number) => Promise<void>
): void {
  new Setting(containerEl)
    .setName(name)
    .setDesc(`${description} (${min}-${max})`)
    .addText((text) => {
      text
        .setValue(String(value))
        .onChange(async (raw) => {
          const parsed = Number(raw);
          if (!Number.isFinite(parsed)) {
            return;
          }
          const clamped = Math.min(max, Math.max(min, Math.round(parsed)));
          await onChange(clamped);
          text.setValue(String(clamped));
        });
      text.inputEl.inputMode = "numeric";
    });
}
