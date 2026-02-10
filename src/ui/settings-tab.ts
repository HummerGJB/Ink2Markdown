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

const RUNTIME_SETTING_DETAILS = {
  maxConcurrency:
    "This limits how many images are converted in parallel by the conversion queue (used as the runWithConcurrency limit). Higher values can finish large notes faster, but they also increase peak memory usage and can trigger more simultaneous provider calls. Lower this if your machine feels sluggish, memory grows quickly, or you see provider rate-limit errors; raise it only if your system and provider limits can handle more parallel work.",
  maxRequestsPerSecond:
    "This is the provider-side request throttle used to construct the RateLimiter for OpenAI and Azure requests. It caps how quickly line transcription, line judging, formatting, title generation, and connection tests are sent. Increase it only if your account has headroom and you want faster throughput; decrease it if you get 429/rate-limit responses or need steadier, lower-impact traffic.",
  maxLineRetries:
    "This controls per-call retries inside transcription with withRetry. It applies to each line transcription call, line-judge call, and final formatting call, so larger values can recover from transient network/provider failures but also multiply total request count and runtime. Keep this low (0-1) for predictable speed/cost, and raise to 2-3 only when you regularly see temporary failures that usually succeed on retry.",
  maxPageRetries:
    "This wraps the entire per-image transcription pipeline in transcribeImageWithRecovery. When a page retry happens, the plugin reruns segmentation and line transcription for that image after a short backoff, which is useful for transient outages but can significantly increase total processing time. Keep it low unless your provider is intermittently failing across whole images.",
  segmentationCacheSize:
    "This sets how many segmented image results are kept in the in-memory segmentation cache (Map) before older entries are evicted. A larger cache avoids repeated segmentation work for the same image/settings combination and can speed repeated conversions, but it increases memory usage. Set to 0 to disable segmentation caching entirely if memory pressure is more important than speed.",
  maxImageDimension:
    "Before segmentation, each image is downscaled so its longest side is at most this many pixels. Lower values reduce memory, processing time, and payload sizes, but aggressive downscaling can blur small handwriting/text and hurt accuracy; higher values preserve detail at higher CPU/memory cost. Use the lowest value that still keeps your smallest text legible.",
  imageJpegQuality:
    "This is passed directly to canvas.toDataURL when line slices are exported as JPEG. Higher quality preserves detail but increases data size and request payloads; lower quality shrinks payloads but can introduce compression artifacts that reduce OCR quality on fine text. This setting is ignored when export format is PNG.",
  imageExportFormat:
    "This chooses the encoded line-slice format sent to the provider from image segmentation. PNG is lossless and generally safest for tiny or high-contrast text, but usually larger; JPEG is smaller/faster to upload, but lossy. If you see missed characters, prefer PNG; if payload size or speed is the bottleneck, try JPEG with a moderate-high quality setting.",
  enableWorkerSegmentation:
    "When enabled, text-region detection attempts to run in a Web Worker instead of the main UI thread, with automatic fallback to main-thread processing if worker execution fails. This can keep the app more responsive during heavy segmentation workloads. Disable only if you need to troubleshoot worker-related behavior or observe compatibility issues in your environment.",
  enableResponseCache:
    "This enables reuse of completed provider responses inside fetchWithRetry for identical requests within the configured TTL. It can reduce repeated API calls, latency, and cost when content/settings produce duplicate requests. Disable it if you need every request to hit the provider directly (for strict freshness); note that identical in-flight requests are still coalesced to one network call.",
  responseCacheTtl:
    "This is the lifetime of cached provider responses before they expire. Longer TTL improves cache hit rate and reduces repeated API work, but may reuse older responses for repeated identical inputs; shorter TTL favors freshness while reducing cache effectiveness. Choose a longer TTL for stable, repeat-heavy workflows and shorter TTL when prompt or image inputs change often.",
  responseCacheMaxEntries:
    "This is the maximum number of cached provider responses kept in memory. When the limit is reached, oldest entries are evicted first. Increase this if you process many repeated inputs and want better cache hit rates; decrease it to control memory growth in long sessions.",
  responseCacheMaxMb:
    "This is an approximate memory budget for cached provider responses. The cache tracks estimated payload size and evicts oldest items when it exceeds this cap, even if entry count is still below its separate limit. Lower it on memory-constrained systems; raise it if you want stronger caching for large responses and have memory headroom.",
  memorySampleInterval:
    "This controls how often the MemoryMonitor samples heap usage during conversion. Short intervals detect spikes earlier and produce finer diagnostics, but add more monitoring overhead; longer intervals reduce overhead but can miss short-lived spikes. Use shorter intervals when investigating memory issues, then increase for normal operation.",
  memoryLeakWarn:
    "This threshold is used by MemoryMonitor leak detection for heap growth across a run. A warning requires growth above this MB value plus at least 20% growth across multiple samples; when triggered, runtime caches are cleared automatically at the end of conversion. Lower it for aggressive detection, or raise it if you get warnings on expected large jobs.",
  logLevel:
    "This controls Logger verbosity globally (applied immediately on save). debug emits the most detail for troubleshooting; info is a balanced default; warn/error reduce log volume to problems only. Use lower verbosity in normal use, and switch to debug when diagnosing failures, performance anomalies, or unexpected retries."
} as const;

export class Ink2MarkdownSettingTab extends PluginSettingTab {
  private plugin: Ink2MarkdownPlugin;

  constructor(app: App, plugin: Ink2MarkdownPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("ink2markdown-settings");

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
        .setDesc("Stored locally in plaintext.")
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
        .setDesc("Stored locally in plaintext.")
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

    addNumericSetting(
      containerEl,
      "Max concurrent images",
      "Pages processed at once.",
      this.plugin.settings.maxConcurrency,
      1,
      8,
      async (value) => {
        this.plugin.settings.maxConcurrency = value;
        await this.plugin.saveSettings();
      },
      RUNTIME_SETTING_DETAILS.maxConcurrency
    );

    addNumericSetting(
      containerEl,
      "Max requests per second",
      "Provider request rate limiter.",
      this.plugin.settings.maxRequestsPerSecond,
      1,
      20,
      async (value) => {
        this.plugin.settings.maxRequestsPerSecond = value;
        await this.plugin.saveSettings();
      },
      RUNTIME_SETTING_DETAILS.maxRequestsPerSecond
    );

    addNumericSetting(
      containerEl,
      "Line retries",
      "Retries for recoverable line failures.",
      this.plugin.settings.maxLineRetries,
      0,
      4,
      async (value) => {
        this.plugin.settings.maxLineRetries = value;
        await this.plugin.saveSettings();
      },
      RUNTIME_SETTING_DETAILS.maxLineRetries
    );

    addNumericSetting(
      containerEl,
      "Page retries",
      "Retries for recoverable page failures.",
      this.plugin.settings.maxPageRetries,
      0,
      3,
      async (value) => {
        this.plugin.settings.maxPageRetries = value;
        await this.plugin.saveSettings();
      },
      RUNTIME_SETTING_DETAILS.maxPageRetries
    );

    addNumericSetting(
      containerEl,
      "Segmentation cache size",
      "Number of segmented images held in memory.",
      this.plugin.settings.segmentationCacheSize,
      0,
      100,
      async (value) => {
        this.plugin.settings.segmentationCacheSize = value;
        await this.plugin.saveSettings();
      },
      RUNTIME_SETTING_DETAILS.segmentationCacheSize
    );

    addNumericSetting(
      containerEl,
      "Max image dimension",
      "Downscale long edge before segmentation (px).",
      this.plugin.settings.maxImageDimension,
      600,
      5000,
      async (value) => {
        this.plugin.settings.maxImageDimension = value;
        await this.plugin.saveSettings();
      },
      RUNTIME_SETTING_DETAILS.maxImageDimension
    );

    addNumericSetting(
      containerEl,
      "JPEG quality (%)",
      "Used when image export format is JPEG.",
      Math.round(this.plugin.settings.imageJpegQuality * 100),
      20,
      100,
      async (value) => {
        this.plugin.settings.imageJpegQuality = value / 100;
        await this.plugin.saveSettings();
      },
      RUNTIME_SETTING_DETAILS.imageJpegQuality
    );

    const imageExportFormatSetting = new Setting(containerEl)
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
    addSettingGuidance(imageExportFormatSetting, RUNTIME_SETTING_DETAILS.imageExportFormat);

    const useWorkerSegmentationSetting = new Setting(containerEl)
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
    addSettingGuidance(useWorkerSegmentationSetting, RUNTIME_SETTING_DETAILS.enableWorkerSegmentation);

    const enableResponseCacheSetting = new Setting(containerEl)
      .setName("Enable response cache")
      .setDesc("Cache completed provider responses (in-flight requests are always coalesced).")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.enableResponseCache)
          .onChange(async (value) => {
            this.plugin.settings.enableResponseCache = value;
            await this.plugin.saveSettings();
          });
      });
    addSettingGuidance(enableResponseCacheSetting, RUNTIME_SETTING_DETAILS.enableResponseCache);

    addNumericSetting(
      containerEl,
      "Response cache TTL (sec)",
      "How long cached provider responses remain valid.",
      Math.round(this.plugin.settings.responseCacheTtlMs / 1000),
      10,
      86400,
      async (value) => {
        this.plugin.settings.responseCacheTtlMs = value * 1000;
        await this.plugin.saveSettings();
      },
      RUNTIME_SETTING_DETAILS.responseCacheTtl
    );

    addNumericSetting(
      containerEl,
      "Response cache max entries",
      "Maximum number of cached responses.",
      this.plugin.settings.responseCacheMaxEntries,
      10,
      2000,
      async (value) => {
        this.plugin.settings.responseCacheMaxEntries = value;
        await this.plugin.saveSettings();
      },
      RUNTIME_SETTING_DETAILS.responseCacheMaxEntries
    );

    addNumericSetting(
      containerEl,
      "Response cache max MB",
      "Approximate memory cap for cached responses.",
      this.plugin.settings.responseCacheMaxBytesMb,
      10,
      1024,
      async (value) => {
        this.plugin.settings.responseCacheMaxBytesMb = value;
        await this.plugin.saveSettings();
      },
      RUNTIME_SETTING_DETAILS.responseCacheMaxMb
    );

    addNumericSetting(
      containerEl,
      "Memory sample interval (ms)",
      "Sampling interval for memory monitor.",
      this.plugin.settings.memorySampleIntervalMs,
      500,
      60000,
      async (value) => {
        this.plugin.settings.memorySampleIntervalMs = value;
        await this.plugin.saveSettings();
      },
      RUNTIME_SETTING_DETAILS.memorySampleInterval
    );

    addNumericSetting(
      containerEl,
      "Leak warning threshold (MB)",
      "Warn when heap growth exceeds this threshold.",
      this.plugin.settings.memoryLeakWarnMb,
      16,
      2048,
      async (value) => {
        this.plugin.settings.memoryLeakWarnMb = value;
        await this.plugin.saveSettings();
      },
      RUNTIME_SETTING_DETAILS.memoryLeakWarn
    );

    const logLevelSetting = new Setting(containerEl)
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
    addSettingGuidance(logLevelSetting, RUNTIME_SETTING_DETAILS.logLevel);

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
  onChange: (value: number) => Promise<void>,
  guidance?: string
): void {
  const setting = new Setting(containerEl)
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

  if (guidance) {
    addSettingGuidance(setting, guidance);
  }
}

function addSettingGuidance(setting: Setting, guidance: string): void {
  const details = setting.descEl.createEl("details", {
    cls: "ink2markdown-setting-guidance"
  });
  details.createEl("summary", {
    text: "How this setting works"
  });
  details.createEl("p", {
    text: guidance
  });
}
