import { App, TFile } from "obsidian";
import { IMAGE_MIME_BY_EXT } from "../constants/config";
import { appendAtEnd } from "../utils/markdown-utils";
import {
  arrayBufferToBase64,
  formatTimestampForFilename,
  getCaptureExtension,
  isRemoteLink
} from "../utils/image-utils";
import { sanitizeTitle } from "../utils/text-utils";

export class FileManagerService {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  async loadImageDataUrl(sourceFile: TFile, linkpath: string): Promise<string> {
    if (isRemoteLink(linkpath)) {
      throw new Error("Embedded image must be a local vault file.");
    }

    const file = this.app.metadataCache.getFirstLinkpathDest(linkpath, sourceFile.path);
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

  async saveAndEmbedCapture(noteFile: TFile, capture: File, index: number): Promise<void> {
    const extension = getCaptureExtension(capture);
    const timestamp = formatTimestampForFilename(new Date());
    const filename = `Ink2Capture ${timestamp}-${String(index).padStart(2, "0")}.${extension}`;
    const attachmentPath = await this.app.fileManager.getAvailablePathForAttachment(
      filename,
      noteFile.path
    );

    const buffer = await capture.arrayBuffer();
    const attachment = await this.app.vault.createBinary(attachmentPath, buffer);
    const link = this.app.fileManager.generateMarkdownLink(attachment, noteFile.path);
    const embed = link.startsWith("!") ? link : `!${link}`;
    const noteText = await this.app.vault.read(noteFile);
    const updated = appendAtEnd(noteText, embed);
    await this.app.vault.modify(noteFile, updated);
  }

  buildAvailableNotePath(file: TFile, title: string): string {
    const safeTitle = sanitizeTitle(title) || "Untitled";
    const folder = file.parent?.path ?? "";
    const basePath = folder ? `${folder}/${safeTitle}.md` : `${safeTitle}.md`;
    if (basePath === file.path) {
      return basePath;
    }

    if (!this.app.vault.getAbstractFileByPath(basePath)) {
      return basePath;
    }

    let counter = 1;
    while (true) {
      const candidate = folder ? `${folder}/${safeTitle} ${counter}.md` : `${safeTitle} ${counter}.md`;
      if (!this.app.vault.getAbstractFileByPath(candidate)) {
        return candidate;
      }
      counter += 1;
    }
  }
}
