import { Notice, Plugin, TFile } from "obsidian";
import { CancellationToken } from "./cancellation";
import { buildPrompts, migrateSettings, validateSettings } from "./settings";
import type { CaptureResult, Ink2MarkdownSettings, PluginState, SettingsExport } from "./types";
import { createProvider } from "../providers/factory";
import { clearResponseCache } from "../providers/http";
import { FileManagerService } from "../services/file-manager";
import { clearSegmentationCache } from "../services/image-processor";
import { disposeSegmentationWorker } from "../services/segmentation-worker";
import { runWithConcurrency, transcribeImageByLines } from "../services/transcription";
import { CaptureModal } from "../ui/modals/capture-modal";
import { PrivacyModal } from "../ui/modals/privacy-modal";
import { ProgressModal } from "../ui/modals/progress-modal";
import { Ink2MarkdownSettingTab } from "../ui/settings-tab";
import { formatError, isRecoverableError, toAppError } from "../utils/error-handler";
import { Logger } from "../utils/logger";
import { findImageEmbeds, insertBelowFrontmatter } from "../utils/markdown-utils";
import { MemoryMonitor } from "../utils/memory-monitor";
import { normalizeTitle } from "../utils/text-utils";
import { CancelledError } from "./errors";

export default class Ink2MarkdownPlugin extends Plugin {
  settings!: Ink2MarkdownSettings;
  private fileManager!: FileManagerService;
  private logger = new Logger("plugin");
  private state: PluginState = {
    status: "idle",
    totalImages: 0,
    completedImages: 0,
    cancelled: false
  };

  async onload(): Promise<void> {
    await this.loadSettings();
    Logger.setGlobalLevel(this.settings.logLevel);
    this.fileManager = new FileManagerService(this.app);

    this.addCommand({
      id: "ink2markdown-convert",
      name: "Ink2Markdown: Convert embedded images to Markdown",
      callback: () => this.runConversion()
    });

    this.addCommand({
      id: "ink2markdown-capture-and-convert",
      name: "Ink2Markdown: Capture images then convert",
      callback: () => this.runCaptureAndConvert()
    });

    this.addCommand({
      id: "ink2markdown-export-settings",
      name: "Ink2Markdown: Export settings to vault",
      callback: () => this.exportSettingsToVault()
    });

    this.addCommand({
      id: "ink2markdown-import-settings-from-active-file",
      name: "Ink2Markdown: Import settings from active file",
      callback: () => this.importSettingsFromActiveFile()
    });

    this.addCommand({
      id: "ink2markdown-export-logs",
      name: "Ink2Markdown: Export logs to vault",
      callback: () => this.exportLogsToVault()
    });

    this.addSettingTab(new Ink2MarkdownSettingTab(this.app, this));
  }

  onunload(): void {
    clearSegmentationCache();
    clearResponseCache();
    disposeSegmentationWorker();
  }

  async runConversion(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      new Notice("No active note found.");
      return;
    }

    await this.runConversionForFile(file);
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = migrateSettings(loaded);
  }

  async saveSettings(): Promise<void> {
    Logger.setGlobalLevel(this.settings.logLevel);
    await this.saveData(this.settings);
  }

  async testConnection(): Promise<void> {
    const configError = validateSettings(this.settings);
    if (configError) {
      new Notice(configError);
      return;
    }

    this.setState({ status: "testing", startedAt: Date.now(), cancelled: false });

    const provider = createProvider(this.settings);
    const token = new CancellationToken();

    try {
      await provider.testConnection(token);
      new Notice("Connection successful.");
    } catch (error) {
      this.recordError(error, "Connection test failed");
      new Notice(formatError(error));
    } finally {
      this.resetState();
    }
  }

  async exportSettingsToVault(): Promise<void> {
    const exportable: Ink2MarkdownSettings = {
      ...this.settings,
      openaiApiKey: "",
      azureApiKey: ""
    };

    const payload: SettingsExport = {
      version: this.settings.schemaVersion,
      exportedAt: new Date().toISOString(),
      settings: exportable
    };

    const path = this.buildAvailablePath("Ink2Markdown-settings", "json");
    await this.app.vault.create(path, `${JSON.stringify(payload, null, 2)}\n`);
    new Notice(`Settings exported to ${path} (API keys omitted).`);
  }

  async importSettingsFromActiveFile(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Open a settings JSON file to import.");
      return;
    }

    const raw = await this.app.vault.read(file);
    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      new Notice("Could not parse JSON from active file.");
      return;
    }

    const candidate = asRecord(parsed);
    const importedSettings =
      candidate.settings && typeof candidate.settings === "object"
        ? candidate.settings
        : candidate;

    const migrated = migrateSettings(importedSettings);

    if (!migrated.openaiApiKey) {
      migrated.openaiApiKey = this.settings.openaiApiKey;
    }
    if (!migrated.azureApiKey) {
      migrated.azureApiKey = this.settings.azureApiKey;
    }

    this.settings = migrated;
    await this.saveSettings();
    new Notice("Settings imported from active file.");
  }

  async exportLogsToVault(): Promise<void> {
    const path = this.buildAvailablePath("Ink2Markdown-logs", "log");
    await this.app.vault.create(path, `${Logger.exportLogs()}\n`);
    new Notice(`Logs exported to ${path}.`);
  }

  private async runConversionForFile(file: TFile): Promise<string | null> {
    const noteText = await this.app.vault.read(file);
    const embeds = findImageEmbeds(noteText);

    if (embeds.length === 0) {
      new Notice("No embedded images found in note.");
      return null;
    }

    const configError = validateSettings(this.settings);
    if (configError) {
      new Notice(configError);
      return null;
    }

    const accepted = await this.ensurePrivacyAccepted();
    if (!accepted) {
      return null;
    }

    this.setState({
      status: "converting",
      startedAt: Date.now(),
      totalImages: embeds.length,
      completedImages: 0,
      cancelled: false,
      lastError: undefined
    });

    const memoryMonitor = new MemoryMonitor({
      sampleIntervalMs: this.settings.memorySampleIntervalMs,
      leakWarnBytes: this.settings.memoryLeakWarnMb * 1024 * 1024,
      logger: this.logger
    });
    memoryMonitor.start("conversion");

    const prompts = buildPrompts(this.settings);
    const provider = createProvider(this.settings);

    const token = new CancellationToken();
    const progressModal = new ProgressModal(this.app, embeds.length, token);
    progressModal.open();

    try {
      let completed = 0;
      const startedAt = Date.now();
      progressModal.setProgress(completed);

      const tasks = embeds.map((embed, index) => async () => {
        if (token.cancelled) {
          throw new CancelledError();
        }

        progressModal.setStatus(`Processing image ${index + 1} of ${embeds.length}...`);

        const imageDataUrl = await this.fileManager.loadImageDataUrl(file, embed.linkpath);
        const markdown = await this.transcribeImageWithRecovery(
          imageDataUrl,
          provider,
          prompts,
          token,
          (lineDone, lineTotal) => {
            progressModal.setDetail(`Image ${index + 1}/${embeds.length}: line ${lineDone}/${lineTotal}`);
          },
          (phase, fraction) => {
            progressModal.setDetail(
              `Image ${index + 1}/${embeds.length}: ${phase} (${Math.round(fraction * 100)}%)`
            );
          }
        );
        if (!markdown.trim()) {
          this.logger.warn("Image transcription returned empty output", {
            imageIndex: index + 1,
            totalImages: embeds.length,
            linkpath: embed.linkpath
          });
        }

        completed += 1;
        memoryMonitor.sample(`after-image-${index + 1}`);
        this.setState({ completedImages: completed });
        progressModal.setProgress(completed);
        progressModal.setEta(estimateSecondsRemaining(startedAt, completed, embeds.length));

        return markdown;
      });

      const pageMarkdown = await runWithConcurrency(tasks, this.settings.maxConcurrency, token);

      if (token.cancelled) {
        throw new CancelledError();
      }

      progressModal.setStatus("Finalizing transcription...");
      progressModal.setDetail("Merging page output.");
      const combined = pageMarkdown.join("\n\n");
      const combinedTrimmed = combined.trim();

      if (!combinedTrimmed) {
        this.logger.warn("Conversion produced empty transcription", {
          totalImages: embeds.length
        });
        progressModal.close();
        new Notice("No transcribable text was detected in the embedded images.");
        return null;
      }

      if (token.cancelled) {
        throw new CancelledError();
      }

      const updated = insertBelowFrontmatter(noteText, combinedTrimmed);
      await this.app.vault.modify(file, updated);

      progressModal.close();
      new Notice("Inserted Markdown transcription at top of note.");
      return combinedTrimmed;
    } catch (error) {
      token.cancel();
      this.setState({ cancelled: true });
      this.recordError(error, "Conversion failed");
      progressModal.close();
      new Notice(formatError(error));
      return null;
    } finally {
      const memoryReport = memoryMonitor.stop();
      if (memoryReport?.leakSuspected) {
        clearSegmentationCache();
        clearResponseCache();
        this.logger.warn("Memory growth threshold exceeded; caches cleared", {
          growthBytes: memoryReport.growthBytes,
          growthPercent: memoryReport.growthPercent
        });
      }

      this.resetState();
    }
  }

  private async transcribeImageWithRecovery(
    imageDataUrl: string,
    provider: ReturnType<typeof createProvider>,
    prompts: ReturnType<typeof buildPrompts>,
    token: CancellationToken,
    onLineProgress: (lineDone: number, lineTotal: number) => void,
    onSegmentationProgress: (phase: string, fraction: number) => void
  ): Promise<string> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.settings.maxPageRetries; attempt += 1) {
      try {
        return await transcribeImageByLines(imageDataUrl, provider, prompts, token, {
          maxLineRetries: this.settings.maxLineRetries,
          imageProcessing: {
            cacheSize: this.settings.segmentationCacheSize,
            exportFormat: this.settings.imageExportFormat,
            jpegQuality: this.settings.imageJpegQuality,
            maxImageDimension: this.settings.maxImageDimension
          },
          useWorkerSegmentation: this.settings.enableWorkerSegmentation,
          onLineProgress,
          onSegmentationProgress
        });
      } catch (error) {
        lastError = error;
        if (attempt >= this.settings.maxPageRetries || !isRecoverableError(error) || token.cancelled) {
          throw error;
        }

        this.logger.warn("Retrying page transcription", {
          attempt: attempt + 1,
          maxRetries: this.settings.maxPageRetries,
          reason: error instanceof Error ? error.message : String(error)
        });

        await wait(250 * (attempt + 1));
      }
    }

    throw lastError;
  }

  private async runCaptureAndConvert(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") {
      new Notice("Open a note to capture images.");
      return;
    }

    this.setState({ status: "capturing", startedAt: Date.now(), cancelled: false });

    const result = await new Promise<CaptureResult>((resolve) => {
      new CaptureModal(
        this.app,
        (capture, index) => this.fileManager.saveAndEmbedCapture(file, capture, index),
        resolve
      ).open();
    });

    if (result.status !== "done") {
      this.resetState();
      return;
    }

    if (result.count === 0) {
      this.resetState();
      new Notice("No photos captured.");
      return;
    }

    const cleaned = await this.runConversionForFile(file);
    if (result.autoTitle && cleaned) {
      await this.generateAndApplyTitle(file, cleaned);
    }

    this.resetState();
  }

  private async ensurePrivacyAccepted(): Promise<boolean> {
    if (this.settings.privacyAcceptedAt) {
      return true;
    }

    const accepted = await new Promise<boolean>((resolve) => {
      const modal = new PrivacyModal(this.app, resolve);
      modal.open();
    });

    if (accepted) {
      this.settings.privacyAcceptedAt = Date.now();
      await this.saveSettings();
    }

    return accepted;
  }

  private async generateAndApplyTitle(file: TFile, markdown: string): Promise<void> {
    const configError = validateSettings(this.settings);
    if (configError) {
      new Notice(configError);
      return;
    }

    const accepted = await this.ensurePrivacyAccepted();
    if (!accepted) {
      return;
    }

    const provider = createProvider(this.settings);
    const token = new CancellationToken();

    try {
      const rawTitle = await provider.generateTitle(markdown, this.settings.titlePrompt, token);
      const title = normalizeTitle(rawTitle);
      if (!title) {
        new Notice("AI title generation returned an empty title.");
        return;
      }

      const targetPath = this.fileManager.buildAvailableNotePath(file, title);
      if (targetPath === file.path) {
        return;
      }

      await this.app.fileManager.renameFile(file, targetPath);
      new Notice(`Renamed note to "${title}".`);
    } catch (error) {
      token.cancel();
      this.recordError(error, "Title generation failed");
      new Notice(formatError(error));
    }
  }

  private setState(patch: Partial<PluginState>): void {
    this.state = {
      ...this.state,
      ...patch
    };
  }

  private resetState(): void {
    this.state = {
      status: "idle",
      totalImages: 0,
      completedImages: 0,
      cancelled: false
    };
  }

  private recordError(error: unknown, message: string): void {
    const appError = toAppError(error);
    this.setState({ lastError: appError });
    this.logger.error(message, {
      code: appError.code,
      recoverable: appError.recoverable,
      detail: appError.message
    });
  }

  private buildAvailablePath(baseName: string, extension: string): string {
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate()
    ).padStart(2, "0")}`;

    const base = `${baseName}-${date}`;
    let candidate = `${base}.${extension}`;
    let index = 1;

    while (this.app.vault.getAbstractFileByPath(candidate)) {
      candidate = `${base}-${index}.${extension}`;
      index += 1;
    }

    return candidate;
  }
}

function estimateSecondsRemaining(startedAt: number, completed: number, total: number): number | null {
  if (completed <= 0 || total <= completed) {
    return null;
  }
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  const perItem = elapsedSeconds / completed;
  return perItem * (total - completed);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
