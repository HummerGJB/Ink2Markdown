import {
  FINAL_FORMAT_PROMPT,
  LINE_JUDGE_PROMPT,
  LINE_TRANSCRIPTION_PROMPT_A,
  LINE_TRANSCRIPTION_PROMPT_B
} from "../constants/prompts";
import { LINE_CONSENSUS_SIMILARITY } from "../constants/config";
import { CancelledError } from "../core/errors";
import type { CancellationToken } from "../core/cancellation";
import type { LineTranscription, Prompts } from "../core/types";
import type { AIProvider } from "../providers/base";
import { segmentImageIntoLines, type ImageProcessingOptions } from "./image-processor";
import {
  hasIllegibleToken,
  lineSimilarity,
  normalizeLineOutput,
  normalizeMultilineOutput,
  pickBetterLine,
  preservesWordSequence
} from "../utils/text-utils";
import { isRecoverableError } from "../utils/error-handler";

export interface TranscriptionOptions {
  maxLineRetries: number;
  imageProcessing: Partial<ImageProcessingOptions>;
  useWorkerSegmentation: boolean;
  onLineProgress?: (completed: number, total: number) => void;
  onSegmentationProgress?: (phase: string, fraction: number) => void;
}

/**
 * Runs line-segmentation transcription for a single image and returns cleaned Markdown.
 * Includes retry and progress callbacks for long-running pages.
 */
export async function transcribeImageByLines(
  imageDataUrl: string,
  provider: AIProvider,
  prompts: Prompts,
  token: CancellationToken,
  options: TranscriptionOptions
): Promise<string> {
  const lineSlices = await segmentImageIntoLines(imageDataUrl, options.imageProcessing, {
    useWorker: options.useWorkerSegmentation,
    onProgress: (phase, fraction) => {
      options.onSegmentationProgress?.(phase, fraction);
    }
  });

  const totalLines = lineSlices.length;
  let completedLines = 0;

  const promptA = buildLinePrompt(prompts.extractionPrompt, LINE_TRANSCRIPTION_PROMPT_A);
  const promptB = buildLinePrompt(prompts.extractionPrompt, LINE_TRANSCRIPTION_PROMPT_B);
  const formattingPrompt = buildLinePrompt(prompts.cleanupPrompt, FINAL_FORMAT_PROMPT);
  const lineResults: LineTranscription[] = [];

  for (const lineSlice of lineSlices) {
    if (token.cancelled) {
      throw new CancelledError();
    }

    const candidateA = normalizeLineOutput(
      await withRetry(
        () => provider.transcribeLine(lineSlice.imageDataUrl, prompts.systemPrompt, promptA, token),
        options.maxLineRetries
      )
    );

    const candidateB = normalizeLineOutput(
      await withRetry(
        () => provider.transcribeLine(lineSlice.imageDataUrl, prompts.systemPrompt, promptB, token),
        options.maxLineRetries
      )
    );

    const similarity = lineSimilarity(candidateA, candidateB);
    let chosen = "";
    let confidence = similarity;

    if (similarity >= LINE_CONSENSUS_SIMILARITY) {
      chosen = pickBetterLine(candidateA, candidateB);
    } else {
      chosen = normalizeLineOutput(
        await withRetry(
          () =>
            provider.judgeLine(
              lineSlice.imageDataUrl,
              prompts.systemPrompt,
              LINE_JUDGE_PROMPT,
              candidateA,
              candidateB,
              token
            ),
          options.maxLineRetries
        )
      );
      if (!chosen) {
        chosen = pickBetterLine(candidateA, candidateB);
      }
      confidence = Math.max(
        similarity,
        lineSimilarity(chosen, candidateA),
        lineSimilarity(chosen, candidateB)
      );
    }

    if (chosen) {
      lineResults.push({
        text: chosen,
        confidence,
        unresolved: hasIllegibleToken(chosen)
      });
    }

    completedLines += 1;
    options.onLineProgress?.(completedLines, totalLines);
  }

  const rawPage = lineResults.map((line) => line.text).join("\n").trimEnd();
  if (!rawPage) {
    return "";
  }

  const formatted = normalizeMultilineOutput(
    await withRetry(
      () => provider.formatTranscription(rawPage, prompts.systemPrompt, formattingPrompt, token),
      options.maxLineRetries
    )
  );

  if (!formatted) {
    return rawPage;
  }

  return preservesWordSequence(rawPage, formatted) ? formatted : rawPage;
}

/**
 * Executes async tasks with a fixed concurrency limit while preserving output order.
 */
export async function runWithConcurrency<T>(
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

async function withRetry<T>(task: () => Promise<T>, maxRetries: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !isRecoverableError(error)) {
        throw error;
      }
      await wait(200 * (attempt + 1));
    }
  }
  throw lastError;
}

function buildLinePrompt(basePrompt: string, fixedPrompt: string): string {
  const trimmed = basePrompt.trim();
  if (!trimmed) {
    return fixedPrompt;
  }
  return `${fixedPrompt}\n\nAdditional context from app configuration:\n${trimmed}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
