import type { ImageEmbed } from "../core/types";

export function findImageEmbeds(noteText: string): ImageEmbed[] {
  const embeds: ImageEmbed[] = [];
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

export function insertBelowFrontmatter(original: string, insertion: string): string {
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

export function appendAtEnd(original: string, insertion: string): string {
  const trimmedInsertion = insertion.trim();
  if (!trimmedInsertion) {
    return original;
  }

  if (!original) {
    return `${trimmedInsertion}\n`;
  }

  let separator = "\n";
  if (original.endsWith("\n\n")) {
    separator = "";
  } else if (original.endsWith("\n")) {
    separator = "\n";
  } else {
    separator = "\n\n";
  }

  return `${original}${separator}${trimmedInsertion}\n`;
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
