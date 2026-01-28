import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile
} from "obsidian";

type ProviderType = "openai" | "azure";

interface Ink2MarkdownSettings {
  provider: ProviderType;
  systemPrompt: string;
  extractionPrompt: string;
  cleanupPrompt: string;
  openaiApiKey: string;
  openaiModel: string;
  azureEndpoint: string;
  azureDeployment: string;
  azureApiVersion: string;
  azureApiKey: string;
  privacyAcceptedAt?: number;
}

interface Prompts {
  systemPrompt: string;
  extractionPrompt: string;
  cleanupPrompt: string;
}

const DEFAULT_SYSTEM_PROMPT =
  "Role: You are an OCR + formatting engine. Your job is to transcribe handwritten/printed notes into valid Obsidian-compatible Markdown with maximum accuracy. Output only Markdown. Do not add commentary.";

const DEFAULT_EXTRACTION_PROMPT = `Task: Transcribe the provided page image into clean, normalized Markdown for Obsidian.
Rules (follow strictly):
1. Output only Markdown (no code fences, no explanations).
2. Normalize: if the author wrote Markdown syntax imperfectly but intent is clear, output the correct Markdown.
3. Headings: Only treat headings as headings when the author wrote leading # marks (#, ##, ###, etc.). Do not infer headings from underline/boxing.
4. Bullets & numbering: Detect bullet and numbered lists even if written as 1), 1., or 1 etc.
5. Indentation: Infer nested lists from visual indentation.
6. Checkboxes: Treat drawn checkboxes or [ ] / [x] as Markdown task items (- [ ] / - [x]).
7. Underlines: Ignore underline as a formatting signal (do not convert underlines into emphasis/highlight).
8. Line breaks: Prefer semantic paragraphs; do not preserve arbitrary line breaks from handwriting if it’s clearly the same sentence.
9. Illegible text: If any word/phrase is unreadable, insert exactly ==ILLEGIBLE== in its place.
10. No extras: Do not invent tags, links, callouts, or tables. Do not summarize.`;

const DEFAULT_CLEANUP_PROMPT = `You will be given multiple chunks of Markdown transcribed from sequential pages of the same note.
Goal: Produce a single, continuous, cleaned-up Markdown note with consistent formatting.
Rules:
1. Only output Markdown.
2. Preserve the author’s wording. You may correct obvious OCR mistakes only when the surrounding context makes the correction highly confident.
3. Fix list continuity, indentation, and numbering.
4. Merge sentences split across page boundaries.
5. Prefer semantic paragraphs.
6. Do not add page separators.
7. Preserve ==ILLEGIBLE== markers as-is.`;

const OPENAI_MODELS = [
  "gpt-5.2",
  "gpt-5.2-pro",
  "gpt-5.2-chat-latest",
  "gpt-5.1",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5-chat-latest"
];

const DEFAULT_SETTINGS: Ink2MarkdownSettings = {
  provider: "openai",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  extractionPrompt: DEFAULT_EXTRACTION_PROMPT,
  cleanupPrompt: DEFAULT_CLEANUP_PROMPT,
  openaiApiKey: "",
  openaiModel: "gpt-5.2",
  azureEndpoint: "",
  azureDeployment: "",
  azureApiVersion: "",
  azureApiKey: ""
};

const DEFAULT_CONCURRENCY = 3;
const REQUEST_TIMEOUT_MS = 60_000;

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
  bmp: "image/bmp"
};

class CancelledError extends Error {
  constructor() {
    super("Ink2Markdown cancelled");
  }
}

class ProviderError extends Error {
  provider: ProviderType;
  status?: number;

  constructor(provider: ProviderType, message: string, status?: number) {
    super(message);
    this.provider = provider;
    this.status = status;
  }
}

class CancellationToken {
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

class ProgressModal extends Modal {
  private statusEl!: HTMLElement;
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

    this.progressEl = contentEl.createEl("progress", {
      cls: "ink2markdown-progressbar"
    });
    this.progressEl.max = 100;
    this.progressEl.value = 0;

    this.cancelButton = contentEl.createEl("button", {
      text: "Cancel",
      cls: "mod-warning"
    });
    this.cancelButton.addEventListener("click", () => {
      this.cancelButton.disabled = true;
      this.setStatus("Cancelling...");
      this.token.cancel();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  setStatus(text: string): void {
    this.statusEl.setText(text);
  }

  setProgress(completed: number): void {
    const percent = this.total === 0 ? 0 : Math.round((completed / this.total) * 100);
    this.progressEl.value = percent;
  }
}

class PrivacyModal extends Modal {
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
    const cancelButton = buttonRow.createEl("button", { text: "Cancel" });

    acceptButton.addEventListener("click", () => this.finish(true));
    cancelButton.addEventListener("click", () => this.finish(false));
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

interface ProviderAdapter {
  transcribePage(
    imageDataUrl: string,
    prompts: Prompts,
    token: CancellationToken
  ): Promise<string>;
  cleanup(markdown: string, prompts: Prompts, token: CancellationToken): Promise<string>;
}

class OpenAIProvider implements ProviderAdapter {
  private apiKey: string;
  private model: string;

  constructor(settings: Ink2MarkdownSettings) {
    this.apiKey = settings.openaiApiKey.trim();
    this.model = settings.openaiModel.trim();
  }

  async transcribePage(
    imageDataUrl: string,
    prompts: Prompts,
    token: CancellationToken
  ): Promise<string> {
    const body = {
      model: this.model,
      instructions: prompts.systemPrompt,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompts.extractionPrompt },
            { type: "input_image", image_url: imageDataUrl }
          ]
        }
      ]
    };

    const response = await fetchWithRetry(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      },
      token,
      "openai"
    );

    return extractOpenAIOutputText(response);
  }

  async cleanup(
    markdown: string,
    prompts: Prompts,
    token: CancellationToken
  ): Promise<string> {
    const body = {
      model: this.model,
      instructions: prompts.systemPrompt,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompts.cleanupPrompt },
            { type: "input_text", text: markdown }
          ]
        }
      ]
    };

    const response = await fetchWithRetry(
      "https://api.openai.com/v1/responses",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      },
      token,
      "openai"
    );

    return extractOpenAIOutputText(response);
  }
}

class AzureOpenAIProvider implements ProviderAdapter {
  private endpoint: string;
  private deployment: string;
  private apiVersion: string;
  private apiKey: string;

  constructor(settings: Ink2MarkdownSettings) {
    this.endpoint = settings.azureEndpoint.trim().replace(/\/+$/, "");
    this.deployment = settings.azureDeployment.trim();
    this.apiVersion = settings.azureApiVersion.trim();
    this.apiKey = settings.azureApiKey.trim();
  }

  async transcribePage(
    imageDataUrl: string,
    prompts: Prompts,
    token: CancellationToken
  ): Promise<string> {
    const body = {
      messages: [
        { role: "system", content: prompts.systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: prompts.extractionPrompt },
            { type: "image_url", image_url: { url: imageDataUrl } }
          ]
        }
      ]
    };

    const response = await fetchWithRetry(
      `${this.endpoint}/openai/deployments/${encodeURIComponent(
        this.deployment
      )}/chat/completions?api-version=${encodeURIComponent(this.apiVersion)}`,
      {
        method: "POST",
        headers: {
          "api-key": this.apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      },
      token,
      "azure"
    );

    return extractAzureOutputText(response);
  }

  async cleanup(
    markdown: string,
    prompts: Prompts,
    token: CancellationToken
  ): Promise<string> {
    const body = {
      messages: [
        { role: "system", content: prompts.systemPrompt },
        {
          role: "user",
          content: [{ type: "text", text: `${prompts.cleanupPrompt}\n\n${markdown}` }]
        }
      ]
    };

    const response = await fetchWithRetry(
      `${this.endpoint}/openai/deployments/${encodeURIComponent(
        this.deployment
      )}/chat/completions?api-version=${encodeURIComponent(this.apiVersion)}`,
      {
        method: "POST",
        headers: {
          "api-key": this.apiKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      },
      token,
      "azure"
    );

    return extractAzureOutputText(response);
  }
}

export default class Ink2MarkdownPlugin extends Plugin {
  settings!: Ink2MarkdownSettings;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.addCommand({
      id: "ink2markdown-convert",
      name: "Ink2Markdown: Convert embedded images to Markdown",
      callback: () => this.runConversion()
    });

    this.addSettingTab(new Ink2MarkdownSettingTab(this.app, this));
  }

  async runConversion(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("No active note found.");
      return;
    }

    const noteText = await this.app.vault.read(file);
    const embeds = findImageEmbeds(noteText);

    if (embeds.length === 0) {
      new Notice("No embedded images found in note.");
      return;
    }

    const configError = validateSettings(this.settings);
    if (configError) {
      new Notice(configError);
      return;
    }

    const accepted = await this.ensurePrivacyAccepted();
    if (!accepted) {
      return;
    }

    const prompts: Prompts = {
      systemPrompt: this.settings.systemPrompt,
      extractionPrompt: this.settings.extractionPrompt,
      cleanupPrompt: this.settings.cleanupPrompt
    };

    const provider: ProviderAdapter =
      this.settings.provider === "openai"
        ? new OpenAIProvider(this.settings)
        : new AzureOpenAIProvider(this.settings);

    const token = new CancellationToken();
    const progressModal = new ProgressModal(this.app, embeds.length, token);
    progressModal.open();

    try {
      let completed = 0;
      progressModal.setProgress(completed);

      const tasks = embeds.map((embed, index) => async () => {
        if (token.cancelled) {
          throw new CancelledError();
        }

        progressModal.setStatus(`Processing image ${index + 1} of ${embeds.length}...`);
        const imageDataUrl = await this.loadImageDataUrl(file, embed.linkpath);
        const markdown = await provider.transcribePage(imageDataUrl, prompts, token);
        completed += 1;
        progressModal.setProgress(completed);
        return markdown;
      });

      const pageMarkdown = await runWithConcurrency(tasks, DEFAULT_CONCURRENCY, token);

      if (token.cancelled) {
        throw new CancelledError();
      }

      progressModal.setStatus("Final formatting cleanup...");
      const combined = pageMarkdown.join("\n\n");
      const cleaned = await provider.cleanup(combined, prompts, token);

      if (token.cancelled) {
        throw new CancelledError();
      }

      const updated = insertBelowFrontmatter(noteText, cleaned.trimEnd());
      await this.app.vault.modify(file, updated);

      progressModal.close();
      new Notice("Inserted Markdown transcription at top of note.");
    } catch (error) {
      token.cancel();
      progressModal.close();
      new Notice(formatError(error));
    }
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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

  private async loadImageDataUrl(sourceFile: TFile, linkpath: string): Promise<string> {
    if (isRemoteLink(linkpath)) {
      throw new Error("Embedded image must be a local vault file.");
    }

    const file = this.app.metadataCache.getFirstLinkpathDest(
      linkpath,
      sourceFile.path
    );

    if (!file) {
      throw new Error(`Image not found in vault: ${linkpath}`);
    }

    const extension = file.extension.toLowerCase();
    const mime = IMAGE_MIME_BY_EXT[extension];
    if (!mime) {
      throw new Error(`Unsupported image format: .${extension}`);
    }

    const data = await this.app.vault.readBinary(file);
    const base64 = arrayBufferToBase64(data);
    return `data:${mime};base64,${base64}`;
  }
}

class Ink2MarkdownSettingTab extends PluginSettingTab {
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
            });
        });
    }

    containerEl.createEl("h3", { text: "Prompts" });

    addPromptSetting(
      containerEl,
      "System prompt",
      "Shared system prompt for extraction and cleanup.",
      this.plugin.settings.systemPrompt,
      async (value) => {
        this.plugin.settings.systemPrompt = value;
        await this.plugin.saveSettings();
      },
      async () => {
        this.plugin.settings.systemPrompt = DEFAULT_SYSTEM_PROMPT;
        await this.plugin.saveSettings();
        this.display();
      },
      "Reset System Prompt"
    );

    addPromptSetting(
      containerEl,
      "Extraction prompt",
      "Prompt used for per-page transcription.",
      this.plugin.settings.extractionPrompt,
      async (value) => {
        this.plugin.settings.extractionPrompt = value;
        await this.plugin.saveSettings();
      },
      async () => {
        this.plugin.settings.extractionPrompt = DEFAULT_EXTRACTION_PROMPT;
        await this.plugin.saveSettings();
        this.display();
      },
      "Reset Extraction Prompt"
    );

    addPromptSetting(
      containerEl,
      "Cleanup prompt",
      "Prompt used for final formatting cleanup.",
      this.plugin.settings.cleanupPrompt,
      async (value) => {
        this.plugin.settings.cleanupPrompt = value;
        await this.plugin.saveSettings();
      },
      async () => {
        this.plugin.settings.cleanupPrompt = DEFAULT_CLEANUP_PROMPT;
        await this.plugin.saveSettings();
        this.display();
      },
      "Reset Cleanup Prompt"
    );

    containerEl.createEl("h3", { text: "Privacy disclosure" });

    const acceptedAt = this.plugin.settings.privacyAcceptedAt;
    const statusText = acceptedAt
      ? `Accepted on ${new Date(acceptedAt).toLocaleString()}`
      : "Not accepted";

    new Setting(containerEl)
      .setName("Disclosure status")
      .setDesc(statusText)
      .addButton((button) => {
        button
          .setButtonText("Review disclosure")
          .onClick(async () => {
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
    text
      .setValue(value)
      .onChange(async (newValue) => {
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

function validateSettings(settings: Ink2MarkdownSettings): string | null {
  if (settings.provider === "openai") {
    if (!settings.openaiApiKey.trim()) {
      return "Missing OpenAI API key.";
    }
    if (!settings.openaiModel.trim()) {
      return "Missing OpenAI model selection.";
    }
  } else {
    if (!settings.azureEndpoint.trim()) {
      return "Missing Azure endpoint.";
    }
    if (!settings.azureDeployment.trim()) {
      return "Missing Azure deployment name.";
    }
    if (!settings.azureApiVersion.trim()) {
      return "Missing Azure API version.";
    }
    if (!settings.azureApiKey.trim()) {
      return "Missing Azure API key.";
    }
  }

  return null;
}

function findImageEmbeds(noteText: string): Array<{ linkpath: string }> {
  const embeds: Array<{ linkpath: string }> = [];
  const regex = /!\[\[([^\]]+)\]\]|!\[[^\]]*\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(noteText)) !== null) {
    const wikiTarget = match[1];
    const mdTarget = match[2];

    if (wikiTarget) {
      const linkpath = normalizeWikiLink(wikiTarget);
      if (linkpath) {
        embeds.push({ linkpath });
      }
      continue;
    }

    if (mdTarget) {
      const linkpath = normalizeMarkdownLink(mdTarget);
      if (linkpath) {
        embeds.push({ linkpath });
      }
    }
  }

  return embeds;
}

function normalizeWikiLink(raw: string): string {
  let link = raw.trim();
  const pipeIndex = link.indexOf("|");
  if (pipeIndex !== -1) {
    link = link.slice(0, pipeIndex);
  }

  link = stripSubpath(link);
  return link.trim();
}

function normalizeMarkdownLink(raw: string): string {
  let link = raw.trim();

  if (link.startsWith("<") && link.endsWith(">")) {
    link = link.slice(1, -1);
  }

  const titleMatch = link.match(/^(.*?)(\s+["'].*["'])$/);
  if (titleMatch) {
    link = titleMatch[1];
  }

  link = stripSubpath(link);
  return link.trim();
}

function stripSubpath(link: string): string {
  const hashIndex = link.indexOf("#");
  if (hashIndex !== -1) {
    link = link.slice(0, hashIndex);
  }
  const caretIndex = link.indexOf("^");
  if (caretIndex !== -1) {
    link = link.slice(0, caretIndex);
  }
  return link;
}

function isRemoteLink(link: string): boolean {
  return /^(https?:\/\/|data:|app:|obsidian:)/i.test(link.trim());
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(buffer).toString("base64");
  }

  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
  token: CancellationToken
): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let inFlight = 0;
  let index = 0;
  let completed = 0;
  let rejected = false;

  return new Promise((resolve, reject) => {
    const launchNext = () => {
      if (rejected) {
        return;
      }
      if (token.cancelled) {
        rejected = true;
        reject(new CancelledError());
        return;
      }

      while (inFlight < limit && index < tasks.length) {
        const current = index++;
        inFlight += 1;

        tasks[current]()
          .then((result) => {
            results[current] = result;
            completed += 1;
          })
          .catch((error) => {
            if (!rejected) {
              rejected = true;
              token.cancel();
              reject(error);
            }
          })
          .finally(() => {
            inFlight -= 1;
            if (!rejected) {
              if (completed === tasks.length) {
                resolve(results);
              } else {
                launchNext();
              }
            }
          });
      }
    };

    launchNext();
  });
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  token: CancellationToken,
  provider: ProviderType
): Promise<any> {
  const maxAttempts = 2;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fetchJson(url, init, token, provider);
    } catch (error) {
      lastError = error;
      if (token.cancelled) {
        throw new CancelledError();
      }
      if (error instanceof ProviderError) {
        if (!isRetryableStatus(error.status) || attempt === maxAttempts) {
          throw error;
        }
      } else if (attempt === maxAttempts) {
        throw error;
      }
    }
  }

  throw lastError;
}

async function fetchJson(
  url: string,
  init: RequestInit,
  token: CancellationToken,
  provider: ProviderType
): Promise<any> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  token.register(controller);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });

    if (!response.ok) {
      const message = await safeReadErrorMessage(response);
      throw new ProviderError(
        provider,
        message || `${provider.toUpperCase()} error (${response.status}).`,
        response.status
      );
    }

    return await response.json();
  } catch (error) {
    if (token.cancelled) {
      throw new CancelledError();
    }
    if (error instanceof ProviderError) {
      throw error;
    }
    if ((error as Error).name === "AbortError") {
      throw new ProviderError(provider, "Request timed out.");
    }
    throw new ProviderError(provider, "Network error while contacting provider.");
  } finally {
    globalThis.clearTimeout(timeout);
    token.unregister(controller);
  }
}

async function safeReadErrorMessage(response: Response): Promise<string | null> {
  try {
    const data = await response.json();
    if (data?.error?.message) {
      return data.error.message;
    }
    if (data?.message) {
      return data.message;
    }
  } catch {
    return null;
  }
  return null;
}

function isRetryableStatus(status?: number): boolean {
  if (!status) {
    return true;
  }
  return status === 429 || status >= 500;
}

function extractOpenAIOutputText(response: any): string {
  if (typeof response?.output_text === "string") {
    return response.output_text;
  }

  if (!Array.isArray(response?.output)) {
    throw new Error("OpenAI response did not include output text.");
  }

  const chunks: string[] = [];
  for (const item of response.output) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const content of item.content) {
        if (content?.type === "output_text" && typeof content.text === "string") {
          chunks.push(content.text);
        }
      }
    }
  }

  const text = chunks.join("");
  if (!text) {
    throw new Error("OpenAI response did not include output text.");
  }
  return text;
}

function extractAzureOutputText(response: any): string {
  const message = response?.choices?.[0]?.message?.content;
  if (typeof message !== "string") {
    throw new Error("Azure response did not include output text.");
  }
  return message;
}

function insertBelowFrontmatter(original: string, insertion: string): string {
  const normalizedInsertion = insertion.trimEnd();
  if (!normalizedInsertion) {
    return original;
  }

  const match = original.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  if (!match) {
    return `${normalizedInsertion}\n\n${original}`;
  }

  const frontmatter = match[0];
  const rest = original.slice(frontmatter.length);
  const separator = rest.startsWith("\n") ? "\n" : "\n\n";

  return `${frontmatter}${normalizedInsertion}${separator}${rest}`;
}

function formatError(error: unknown): string {
  if (error instanceof CancelledError) {
    return "Ink2Markdown cancelled.";
  }

  if (error instanceof ProviderError) {
    const status = error.status ? ` (HTTP ${error.status})` : "";
    return `${error.provider === "openai" ? "OpenAI" : "Azure OpenAI"} error${status}: ${error.message}`;
  }

  if (error instanceof Error) {
    return error.message || "Unexpected error.";
  }

  return "Unexpected error.";
}
