export function normalizeTitle(raw: string): string {
  const firstLine = raw.split(/\r?\n/)[0]?.trim() ?? "";
  const stripped = firstLine.replace(/^["'“”]+|["'“”]+$/g, "");
  return sanitizeTitle(stripped);
}

export function sanitizeTitle(title: string): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/\.+$/, "");
  if (!cleaned) {
    return "";
  }
  return cleaned.length > 80 ? cleaned.slice(0, 80).trim() : cleaned;
}

export function normalizeLineOutput(text: string): string {
  const normalized = normalizeMultilineOutput(text);
  if (!normalized) {
    return "";
  }
  return normalized.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
}

export function normalizeMultilineOutput(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

export function pickBetterLine(a: string, b: string): string {
  const aIllegible = countIllegible(a);
  const bIllegible = countIllegible(b);
  if (aIllegible !== bIllegible) {
    return aIllegible < bIllegible ? a : b;
  }
  if (a.length !== b.length) {
    return a.length > b.length ? a : b;
  }
  return a;
}

export function hasIllegibleToken(text: string): boolean {
  return text.includes("==ILLEGIBLE==");
}

export function countIllegible(text: string): number {
  const matches = text.match(/==ILLEGIBLE==/g);
  return matches ? matches.length : 0;
}

export function preservesWordSequence(raw: string, formatted: string): boolean {
  const rawWords = tokenizeWords(raw);
  const formattedWords = tokenizeWords(formatted);
  if (rawWords.length !== formattedWords.length) {
    return false;
  }
  for (let i = 0; i < rawWords.length; i += 1) {
    if (rawWords[i] !== formattedWords[i]) {
      return false;
    }
  }
  return true;
}

export function lineSimilarity(lineA: string, lineB: string): number {
  const a = normalizeLineForSimilarity(lineA);
  const b = normalizeLineForSimilarity(lineB);
  if (!a && !b) {
    return 1;
  }
  if (!a || !b) {
    return 0;
  }
  const distance = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - distance / maxLen;
}

function tokenizeWords(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/==illegible==/g, " illegible ")
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
  return normalized ? normalized.split(/\s+/) : [];
}

function normalizeLineForSimilarity(line: string): string {
  return line
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) {
    return bLen;
  }
  if (bLen === 0) {
    return aLen;
  }

  let prev = new Array<number>(bLen + 1);
  for (let j = 0; j <= bLen; j += 1) {
    prev[j] = j;
  }

  for (let i = 1; i <= aLen; i += 1) {
    const cur = new Array<number>(bLen + 1);
    cur[0] = i;
    const aChar = a.charAt(i - 1);
    for (let j = 1; j <= bLen; j += 1) {
      const cost = aChar === b.charAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }

  return prev[bLen];
}
