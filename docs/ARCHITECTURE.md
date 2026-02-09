# Ink2Markdown Architecture

## Layering

1. `core`
- owns plugin lifecycle, commands, persisted settings, and plugin state.

2. `providers`
- adapts OpenAI/Azure APIs behind a shared `AIProvider` contract.
- centralizes HTTP behavior (timeouts, retries, response parsing).

3. `services`
- `image-processor`: line segmentation, downscaling, cache.
- `transcription`: orchestration and line/page retry logic.
- `file-manager`: Obsidian vault attachment and note operations.

4. `ui`
- modals and settings tab only.
- no provider-specific logic in UI components.

5. `utils`
- pure utility modules for low coupling and testability.

## Error Handling

- Provider/network errors are normalized into `AppError` via `toAppError`.
- Recoverable failures (`429`, `5xx`, transient network) are retried based on settings.
- Non-recoverable failures are surfaced immediately to the user.

## Performance Strategy

- Request rate-limiting per provider instance.
- Identical request coalescing (in-flight dedupe) to avoid duplicate provider calls.
- Response caching with TTL and bounded entry/size limits.
- Configurable page concurrency.
- Configurable line and page retry counts.
- Pre-segmentation image downscaling.
- Worker-backed image segmentation with main-thread fallback.
- Segmentation cache (bounded LRU-like map).
- Periodic memory sampling with leak-threshold detection and cache cleanup on high growth.

## Extension Points

- Add new providers by implementing `AIProvider` and updating `providers/factory.ts`.
- Add new workflow steps by extending `services/transcription.ts` orchestration.
- Add new settings via `core/types.ts`, `core/settings.ts`, and `ui/settings-tab.ts`.
