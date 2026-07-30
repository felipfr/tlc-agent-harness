import { readTail } from "../../platform/fs-jsonl.ts";

export type TranscriptUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

const DEFAULT_TAIL_LINES = 200;

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function usageOf(record: unknown): Record<string, unknown> | undefined {
  const message = asRecord(asRecord(record)?.message);
  return asRecord(message?.usage);
}

/** Best-effort — the transcript is written asynchronously and may lag, so any read failure degrades to null. */
export function readClaudeUsage(
  transcriptPath: string | undefined,
  tailLines: number = DEFAULT_TAIL_LINES,
): TranscriptUsage | null {
  if (!transcriptPath) {
    return null;
  }

  let records: unknown[];
  try {
    records = readTail<unknown>(transcriptPath, tailLines);
  } catch {
    return null;
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let found = false;

  for (const record of records) {
    const usage = usageOf(record);
    if (!usage) {
      continue;
    }
    found = true;
    inputTokens += asNumber(usage.input_tokens);
    outputTokens += asNumber(usage.output_tokens);
    cacheReadTokens += asNumber(usage.cache_read_input_tokens);
    cacheWriteTokens += asNumber(usage.cache_creation_input_tokens);
  }

  return found ? { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } : null;
}
