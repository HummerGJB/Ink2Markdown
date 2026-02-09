# Ink2Markdown

Ink2Markdown is an Obsidian plugin that transcribes embedded note images into Markdown using OpenAI or Azure OpenAI.

## Architecture

The plugin is organized as a modular TypeScript codebase:

- `src/core`: plugin lifecycle, state, settings, shared types
- `src/providers`: AI provider adapters, factory, HTTP/retry/rate-limit logic
- `src/services`: image processing, transcription orchestration, file operations
- `src/ui`: settings tab and modal components
- `src/utils`: logging, error handling, markdown/text/image helpers
- `src/constants`: prompts, config, error strings
- `src/tests`: unit/integration tests and fixtures

## Refactor Highlights

- Provider abstraction with `AIProvider` and factory-based instantiation
- Settings migration with schema versioning and runtime validation
- Service-layer split for transcription, image segmentation, and vault file operations
- Structured logging with configurable log levels and log export
- App-level error model and recoverability-based retries
- Configurable performance knobs:
  - page concurrency
  - provider request rate limit
  - line/page retry counts
  - segmentation cache size
  - image downscaling and line-slice output format
- Worker-based image segmentation with fallback to main thread
- Progressive conversion feedback (segmentation phase + per-line progress + ETA)
- Provider request coalescing and response caching with TTL/size caps
- Runtime memory sampling with leak-threshold detection and automatic cache cleanup
- Export/import settings flow in plugin commands/settings UI

## Development

### Prerequisites

- Node.js 20+
- npm

### Scripts

- `npm run dev`: watch/rebuild plugin bundle
- `npm run build`: production bundle
- `npm run typecheck`: TypeScript type checking
- `npm run lint`: alias for typecheck
- `npm run test`: compile and run Node test suite
- `npm run ci`: lint + test + build
- `npm run setup:hooks`: configure local git hooks path

## Testing

Test suites live in:

- `src/tests/unit`
- `src/tests/integration`

The test command compiles TS test files to `.tmp-tests` and runs Node's built-in test runner.

## Settings Import/Export

Ink2Markdown now supports:

- Export settings to vault JSON (`Ink2Markdown: Export settings to vault`)
- Import settings from currently open JSON file (`Ink2Markdown: Import settings from active file`)
- Export plugin logs to vault (`Ink2Markdown: Export logs to vault`)

Notes:

- Exported settings intentionally omit API keys.
- Import preserves your current API keys if keys are not present in the imported file.

## Troubleshooting

- `Missing OpenAI API key` or `Missing Azure ...`:
  - open plugin settings and fill required provider fields
- `Request timed out`:
  - reduce concurrency and request rate, then retry
- frequent `429` responses:
  - lower `Max requests per second` and/or `Max concurrent images`
- unexpected conversion failure:
  - export logs with `Ink2Markdown: Export logs to vault` and inspect the latest file

## Migration Notes

The settings schema now includes operational/performance fields. Existing saved settings are migrated automatically on load.
