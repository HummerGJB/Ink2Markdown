export const DEFAULT_SYSTEM_PROMPT =
  "Role: You are a transcription engine. Top priority: verbatim accuracy. Transcribe handwritten/printed notes into Obsidian-compatible Markdown. Do not add, remove, or paraphrase content. Output only Markdown.";

export const DEFAULT_EXTRACTION_PROMPT = `Task: Transcribe the provided page image into Markdown for Obsidian.
Primary objective: exact transcription of the visible text.
Rules (follow strictly):
1. Output only Markdown (no code fences, no explanations).
2. Preserve the original wording, spelling, capitalization, punctuation, and line breaks as written.
3. Use Markdown syntax only when it is explicitly written or drawn (e.g., leading # for headings, bullet characters -, *, •, numbered list markers like 1. or 1), checkboxes [ ]/[x] or drawn boxes, ==highlight==).
4. Headings: Only when the author wrote leading # marks. Do not infer headings from underlines, layout, or size.
5. Lists: Only create list items when a bullet/number is explicitly present; use indentation only when it is clearly present in the handwriting.
6. Checkboxes: Treat drawn checkboxes or [ ] / [x] as Markdown task items (- [ ] / - [x]).
7. Highlights: Preserve ==highlight== syntax only when the author explicitly wrote ==...==.
8. Horizontal rules: A straight line spanning at least ~50% of the page width should become a Markdown horizontal rule: ---.
9. Illegible text: If any word/phrase is unreadable, insert exactly ==ILLEGIBLE== in its place.
10. No extras: Do not invent tags, links, callouts, or tables. Do not summarize.`;

export const DEFAULT_CLEANUP_PROMPT = `You will be given multiple chunks of Markdown transcribed from sequential pages of the same note.
Goal: Produce a single, continuous Markdown note while preserving transcription accuracy.
Rules:
1. Only output Markdown.
2. Do not change wording, spelling, capitalization, or punctuation. Do not correct OCR mistakes.
3. Preserve line breaks unless a sentence is clearly split across page boundaries; if you join, do not alter words.
4. Fix list continuity, indentation, and numbering only when list markers already exist.
5. Do not add page separators.
6. Preserve ==ILLEGIBLE== markers as-is.`;

export const DEFAULT_TITLE_PROMPT = `You generate concise, descriptive note titles.
Given the full note content, return a short title (3-6 words) that captures the main topic.
Output only the title text with no quotes, no punctuation at the end, and no extra commentary.`;

export const LINE_TRANSCRIPTION_PROMPT_A = `You are given an image of one handwritten text line.
Transcribe exactly what is written in that line.
Rules:
1. Output only the text for this line (no commentary, no code fences).
2. Preserve wording, spelling, capitalization, punctuation, and symbols exactly.
3. Preserve explicit Markdown markers if present (#, -, *, [ ], [x], == ==).
4. Do not infer missing words.
5. If a token is unreadable, write ==ILLEGIBLE== exactly.`;

export const LINE_TRANSCRIPTION_PROMPT_B = `Transcribe this handwritten line independently from scratch.
Rules:
1. Output only the line text.
2. Do not paraphrase or normalize.
3. Keep all visible symbols and Markdown markers exactly.
4. If uncertain, prefer ==ILLEGIBLE== over guessing.`;

export const LINE_JUDGE_PROMPT = `You are given one handwritten line image and two candidate transcriptions.
Pick the candidate that best matches the image. If both are partially wrong, output a corrected line from the image.
Rules:
1. Output only one final line.
2. Preserve exact wording, spelling, punctuation, and symbols.
3. Do not add content not visible in the image.
4. Use ==ILLEGIBLE== for unreadable tokens.`;

export const FULL_PAGE_TRANSCRIPTION_PROMPT = `You are given one full handwritten page image.
Transcribe all visible text from the entire page into Markdown.
Rules:
1. Output only Markdown (no commentary, no code fences).
2. Preserve wording, spelling, capitalization, punctuation, and symbols exactly.
3. Keep content in reading order (top-to-bottom, left-to-right).
4. Use ==ILLEGIBLE== for unreadable words or tokens.`;

export const FINAL_FORMAT_PROMPT = `You will be given raw line-by-line transcription text from one page.
Reformat it into clean Markdown structure while preserving text content.
Rules:
1. Do not change, remove, or add any words.
2. You may only adjust spacing, line breaks, and Markdown markers.
3. Keep line order unchanged.
4. Output only Markdown.`;

export const OPENAI_MODELS = [
  "gpt-5.2",
  "gpt-5.2-pro",
  "gpt-5.2-chat-latest",
  "gpt-5.1",
  "gpt-5",
  "gpt-5-mini",
  "gpt-5-nano",
  "gpt-5-chat-latest"
] as const;
