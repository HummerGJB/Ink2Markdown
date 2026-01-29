PRD — Ink2Markdown (Obsidian plugin)

1. Summary

Ink2Markdown converts handwritten meeting notes (photos embedded in an Obsidian note) into clean, normalized Obsidian-flavored Markdown, inserts the result at the very top of the note (below YAML frontmatter), and leaves the original images in place underneath.

It also provides a mobile-first capture flow: a single command uses the current note, launches the camera, appends each photo to the bottom of the note, and then runs the conversion when capture is finished.

It runs a page-by-page extraction loop (1 API call per image), then a final cleanup pass (1 API call over the concatenated extracted text) to improve cross-page formatting continuity and fix high-confidence OCR errors.

Supports OpenAI and Azure OpenAI as providers, with configurable prompts and “reset to default” buttons.

Key product objective: accuracy and minimal friction.

⸻

2. Goals and non-goals

Goals
	1.	Highest practical accuracy for converting handwritten/printed notes into Markdown.
	2.	Simple workflow: embed images → run command → get final Markdown inserted.
	3.	Markdown normalization: infer and correct “almost-right” Markdown intent.
	4.	Cross-page continuity: cleanup pass merges page breaks, fixes list/indent continuity.
	5.	Clear privacy disclosure + one-time acceptance (since images are uploaded).
	6.	Works on macOS desktop and Obsidian iOS (within platform constraints).
	7.	Mobile-first capture loop: one command to capture multiple pages quickly.

Non-goals (v1)
	•	Tables, callouts, tag/link inference, diagram/mermaid conversion.
	•	Per-page preview UI or per-page raw extraction retention in the note.
	•	Caching, diff-friendly mode, multi-provider profiles, prompt variables, prompt versioning.
	•	Underline-based formatting inference (explicitly ignored).

⸻

3. Target user
	•	Primary persona: a user taking handwritten notes in meetings, using lightweight Markdown cues (e.g., ##, bullets) on paper, then importing photos into Obsidian.

⸻

4. User stories

Core story (happy path)
	1.	User creates/opens a note in Obsidian.
	2.	User embeds one or more note page photos into the note (each image = one page).
	3.	User runs command: Ink2Markdown: Convert embedded images to Markdown (Command Palette).
	4.	Plugin processes images in the order they appear in the note.
	5.	Plugin performs final cleanup pass across the combined text.
	6.	Plugin inserts the final Markdown at top of note, below YAML frontmatter.
	7.	Original images remain embedded below.

Capture story (mobile-first)
	1.	User runs command: Ink2Markdown: Capture images then convert.
	2.	User has an active note; the plugin uses that note (no new note creation).
	3.	Plugin opens the camera/file picker and the user captures pages one by one.
	4.	Each captured image is saved as an attachment and appended to the bottom of the note.
	5.	User finishes capture.
	6.	Plugin runs the conversion on that same note, inserting Markdown at the top while keeping images below.

Configuration story
	•	User opens plugin settings tab and configures:
	•	Provider: OpenAI vs Azure OpenAI
	•	Credentials/endpoint details
	•	Model selection (OpenAI dropdown)
	•	Editable default prompts (System + Extraction + Cleanup), each with “Reset to default”
	•	One-time privacy disclosure acknowledgement status (read-only display)

Obsidian supports plugin commands (addCommand) and plugin settings tabs (addSettingTab / PluginSettingTab).  ￼

⸻

5. Functional requirements

5.1 Image discovery and ordering

FR-1: Ink2Markdown processes only image embeds in the active note (no external scanning of vault).
FR-2: Order is exactly the sequence of image embeds as they appear in the note body.
FR-3: Supported formats: common image types Obsidian embeds (e.g., jpg/png/heic where available). If unsupported/unreadable, fail the run (see failure policy).

5.2 Provider support (OpenAI / Azure OpenAI)

FR-4: Provider dropdown:
	•	OpenAI
	•	Azure OpenAI

FR-5 (OpenAI): Use OpenAI Images/Vision input mechanism (base64 data URL or URL).  ￼
FR-6 (Azure OpenAI): Use Azure chat completions with vision-enabled deployment; send images as supported by Azure (base64 is common for local images).  ￼

FR-7: Credentials stored in plugin settings data (plaintext as requested). Settings persist via Obsidian settings system.  ￼

5.3 Model selection

FR-8 (OpenAI): Model dropdown includes OpenAI’s current GPT-5 family options appropriate for text+image input, sourced from OpenAI’s Models documentation.  ￼
FR-9 (Azure): Model selection is by deployment name (text field) + API version (text field), because Azure deployments are tenant-specific.  ￼

5.4 Extraction loop (per image)

FR-10: For each embedded image:
	•	Load image bytes from vault
	•	Encode to base64 data URL (or equivalent)
	•	Call provider with:
	•	System prompt (editable default)
	•	Extraction user prompt (editable default)
	•	Image content
	•	Receive Markdown text output for that page
	•	Store in memory in an ordered array (page index)

FR-11: Parallelism allowed. Constraint:
	•	Preserve output order in final concatenation.
	•	Default: small bounded concurrency (e.g., 2–4) to avoid spiky failures; adjust later.

5.5 Cleanup pass (final formatting)

FR-12: After all pages extracted, concatenate with a simple join (e.g., \n\n) and send one cleanup call:
	•	System prompt (same system prompt)
	•	Cleanup user prompt (editable default)
	•	Combined extracted text as input

FR-13: Cleanup must:
	•	Fix formatting continuity (lists/indentation)
	•	Merge sentences split across pages
	•	Prefer semantic paragraphs
	•	Only correct words when high-confidence contextual OCR error

FR-14: Cleanup must not add page separators.

5.6 Insertion into note

FR-15: Insert final Markdown at top of note body, below YAML frontmatter if frontmatter exists; otherwise at file start.

FR-16: Images remain in place below inserted text (no moving/removal).

5.6.1 Capture loop (mobile-first)

FR-21: Provide a second command: Ink2Markdown: Capture images then convert.
FR-22: Requires an active Markdown note; if none is active, show a notice and do not start capture.
FR-23: Launch the device camera/file picker via a file input (accept image/*, capture=environment) and allow repeated captures until the user finishes.
FR-24: Each captured image is saved as an attachment using Obsidian’s attachment path rules and embedded at the bottom of the note.
FR-25: When capture finishes, run the standard conversion flow on that same note (text inserted at top, images remain below).
FR-26: If no photos are captured, show a notice and do not run conversion.

5.7 Illegible marker

FR-17: When the model cannot confidently read a word/phrase, it must output ==ILLEGIBLE== exactly (caps + highlight). (The prompts will enforce this.)

5.7.1 Horizontal rules

FR-20: A straight line spanning at least ~50% of the page width should be converted to a Markdown horizontal rule (---).

5.8 Failure policy (all-or-nothing)

FR-18: If any page extraction fails (API error, timeout, parse issues), the run:
	•	stops immediately
	•	shows an error
	•	makes no changes to the note

5.9 Cancellation

FR-19: User can cancel mid-run from the progress UI:
	•	stop starting new requests
	•	abort in-flight requests where possible
	•	make no changes to the note

⸻

6. UX requirements

6.1 Command
	•	Command Palette entry: Ink2Markdown: Convert embedded images to Markdown (via addCommand).  ￼
	•	Command Palette entry: Ink2Markdown: Capture images then convert (via addCommand).

6.2 Capture UI

A modal containing:
	•	Title and short instructions
	•	“Take photo” button (opens camera/file picker)
	•	“Done” button (finishes capture and starts conversion)
	•	“Cancel” button (closes capture without conversion)
	•	Status line showing capture count

6.3 Progress UI

A modal (or notice panel) containing:
	•	Progress bar: 0–100%
	•	Status text examples:
	•	“Processing image 1 of 5…”
	•	“Processing image 5 of 5…”
	•	“Final formatting cleanup…”
	•	Cancel button

6.4 Completion
	•	Success notice: “Inserted Markdown transcription at top of note.”
	•	Cursor/scroll behavior (default): leave view where user was; do not auto-jump.

6.5 Error messaging
	•	Clear, actionable errors:
	•	Missing API key / endpoint / deployment name
	•	Unsupported image format
	•	Provider error (surface HTTP status + brief message)
	•	“No embedded images found in note”
	•	“Open a note to capture images”

⸻

7. Settings (configuration)

Obsidian settings UI patterns and plugin settings persistence are documented in Obsidian’s settings guides.  ￼

7.1 Common settings
	•	Provider: OpenAI | Azure OpenAI
	•	System prompt (editable multiline)
	•	Button: “Reset System Prompt”
	•	Extraction prompt (editable multiline)
	•	Button: “Reset Extraction Prompt”
	•	Cleanup prompt (editable multiline)
	•	Button: “Reset Cleanup Prompt”
	•	One-time disclosure acceptance:
	•	Display acceptance status + date/time (if stored)
	•	Button only for “Review disclosure” (optional). No re-prompt unless settings reset.

7.2 OpenAI settings
	•	API Key (plaintext)
	•	Model dropdown (from OpenAI Models list)  ￼

7.3 Azure OpenAI settings
	•	Endpoint base URL (e.g., https://{resource}.openai.azure.com/)
	•	Deployment name
	•	API version
	•	API key / auth header value

Azure vision-enabled chat usage and endpoints are described in Microsoft’s Azure OpenAI documentation.  ￼

⸻

8. One-time privacy disclosure and consent

Because the plugin uploads images to OpenAI/Azure:
	•	On first run, show a modal:
	•	“Ink2Markdown sends your embedded note images to the configured AI provider for transcription.”
	•	“Do not use with sensitive/confidential information unless you accept this.”
	•	Buttons: I Understand (required) / Cancel
	•	Store acceptance flag.

(Obsidian community plugins can access vault contents; desktop plugins run with user permissions, so disclosure is important for user trust and safety.  ￼)

⸻

9. Prompt architecture (defaults)

OpenAI supports providing images as URLs or base64 data URLs.  ￼

9.1 Default System Prompt (editable)

Role: You are an OCR + formatting engine. Your job is to transcribe handwritten/printed notes into valid Obsidian-compatible Markdown with maximum accuracy. Output only Markdown. Do not add commentary.

9.2 Default Extraction Prompt (editable)

Task: Transcribe the provided page image into clean, normalized Markdown for Obsidian.
Rules (follow strictly):
	1.	Output only Markdown (no code fences, no explanations).
	2.	Normalize: if the author wrote Markdown syntax imperfectly but intent is clear, output the correct Markdown.
	3.	Headings: Treat headings when the author wrote leading # marks (#, ##, ###, etc.). Do not infer headings from underlines.
	4.	Bullets & numbering: Detect bullet and numbered lists even if written as 1), 1., or 1 etc.
	5.	Indentation: Infer nested lists from visual indentation.
	6.	Checkboxes: Treat drawn checkboxes or [ ] / [x] as Markdown task items (- [ ] / - [x]).
	7.	Highlights: Preserve ==highlight== syntax only when the author explicitly wrote ==...==.
	8.	Horizontal rules: A straight line spanning at least ~50% of the page width should become a Markdown horizontal rule: ---.
	9.	Line breaks: Prefer semantic paragraphs; do not preserve arbitrary line breaks from handwriting if it’s clearly the same sentence.
	10.	Illegible text: If any word/phrase is unreadable, insert exactly ==ILLEGIBLE== in its place.
	11.	No extras: Do not invent tags, links, callouts, or tables. Do not summarize.

9.3 Default Cleanup Prompt (editable)

You will be given multiple chunks of Markdown transcribed from sequential pages of the same note.
Goal: Produce a single, continuous, cleaned-up Markdown note with consistent formatting.
Rules:
	1.	Only output Markdown.
	2.	Preserve the author’s wording. You may correct obvious OCR mistakes only when the surrounding context makes the correction highly confident.
	3.	Fix list continuity, indentation, and numbering.
	4.	Merge sentences split across page boundaries.
	5.	Prefer semantic paragraphs.
	6.	Do not add page separators.
	7.	Preserve ==ILLEGIBLE== markers as-is.

⸻

10. Technical requirements (implementation-facing)

10.1 Note parsing
	•	Parse the active note’s Markdown to find embedded images in order.
	•	Resolve each embed to an actual file in the vault.
	•	Read bytes via Obsidian’s vault APIs (avoid raw filesystem assumptions for mobile compatibility).

10.2 Provider adapters
	•	Define a provider interface:
	•	transcribePage(imageBytes, prompts, model/deployment) -> markdownText
	•	cleanup(markdownCombined, prompts, model/deployment) -> markdownText
	•	OpenAI adapter: Chat/Responses request with image as base64 data URL.  ￼
	•	Azure adapter: Chat Completions endpoint + vision-enabled deployment as per Azure docs.  ￼

10.3 Concurrency + ordering
	•	Use bounded concurrency.
	•	Store results by page index; join in page order before cleanup.
	•	Ensure cancellation stops queue and prevents insertion.

10.4 Safety and stability
	•	Timeouts and retry policy (lightweight):
	•	1 retry for transient network errors
	•	no retry for auth/config errors

⸻

11. Acceptance criteria (definition of done)

Core
	1.	With a note containing N embedded images, plugin processes exactly those N images in note order.
	2.	Final Markdown is inserted at the top, below YAML frontmatter.
	3.	Images remain embedded and unchanged below the inserted Markdown.
	4.	Output uses normalized Markdown and inferred indentation where visually present.
	5.	Cleanup merges cross-page sentence breaks and fixes list continuity.
	6.	Any unreadable word becomes ==ILLEGIBLE==.

UX
	7.	Progress UI shows current step and allows cancel.
	8.	On any failure: no partial insertion occurs; user sees a clear error.

Settings
	9.	OpenAI and Azure provider modes each require the appropriate fields.
	10.	Prompts are editable; each has a working “Reset to default”.

⸻

12. Release plan (single version as requested)

v1 (this PRD)
	•	Everything specified above.

Post-v1 backlog (explicitly out of scope)
	•	Language support beyond English
	•	Image preprocessing (deskew/perspective/contrast)
	•	Per-page preview and selective re-run
	•	Caching
	•	Model/deployment discovery for Azure
	•	Multi-profile support

⸻

13. Notes on model list and documentation sources
	•	OpenAI’s official Models documentation is the source of truth for model availability and naming (used for the OpenAI dropdown).  ￼
	•	OpenAI vision input methods (URL/base64/file id) are described in the Images & Vision guide.  ￼
	•	Azure vision-enabled chat usage and endpoints are described in Microsoft’s Azure OpenAI documentation.  ￼
