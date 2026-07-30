import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { appendRecord } from "../../../platform/fs-jsonl.ts";
import { readClaudeUsage } from "../claude.transcript.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "claude-transcript-test-"));
}

test("sums input and output tokens across two usage entries", () => {
  const dir = tempDir();
  const target = join(dir, "transcript.jsonl");
  appendRecord(target, { message: { usage: { input_tokens: 100, output_tokens: 20 } } });
  appendRecord(target, { message: { usage: { input_tokens: 50, output_tokens: 10 } } });
  const usage = readClaudeUsage(target);
  assert.equal(usage?.inputTokens, 150);
  assert.equal(usage?.outputTokens, 30);
  rmSync(dir, { recursive: true, force: true });
});

test("sums cache read and cache write tokens", () => {
  const dir = tempDir();
  const target = join(dir, "transcript.jsonl");
  appendRecord(target, {
    message: {
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 30,
      },
    },
  });
  const usage = readClaudeUsage(target);
  assert.equal(usage?.cacheReadTokens, 200);
  assert.equal(usage?.cacheWriteTokens, 30);
  rmSync(dir, { recursive: true, force: true });
});

test("a missing file yields null usage without throwing", () => {
  const dir = tempDir();
  const target = join(dir, "does-not-exist.jsonl");
  assert.doesNotThrow(() => readClaudeUsage(target));
  assert.equal(readClaudeUsage(target), null);
  rmSync(dir, { recursive: true, force: true });
});

test("an unreadable path (a directory, not a file) yields null usage without throwing", () => {
  const dir = tempDir();
  const target = join(dir, "transcript.jsonl");
  mkdirSync(target);
  assert.doesNotThrow(() => readClaudeUsage(target));
  assert.equal(readClaudeUsage(target), null);
  rmSync(dir, { recursive: true, force: true });
});

test("a transcript with records but no parseable usage yields null", () => {
  const dir = tempDir();
  const target = join(dir, "transcript.jsonl");
  appendRecord(target, { message: { role: "assistant", content: "hello" } });
  appendRecord(target, { some: "unrelated record" });
  assert.equal(readClaudeUsage(target), null);
  rmSync(dir, { recursive: true, force: true });
});

test("an empty transcript file yields null", () => {
  const dir = tempDir();
  const target = join(dir, "transcript.jsonl");
  appendFileSync(target, "");
  assert.equal(readClaudeUsage(target), null);
  rmSync(dir, { recursive: true, force: true });
});

test("a truncated final line is skipped and earlier usage is still counted", () => {
  const dir = tempDir();
  const target = join(dir, "transcript.jsonl");
  appendRecord(target, { message: { usage: { input_tokens: 100, output_tokens: 20 } } });
  appendFileSync(target, '{"message":{"usage":{"input_tokens":999,"trunca');
  const usage = readClaudeUsage(target);
  assert.equal(usage?.inputTokens, 100);
  assert.equal(usage?.outputTokens, 20);
  rmSync(dir, { recursive: true, force: true });
});

test("a malformed final line is skipped and earlier usage is still counted", () => {
  const dir = tempDir();
  const target = join(dir, "transcript.jsonl");
  appendRecord(target, { message: { usage: { input_tokens: 5, output_tokens: 1 } } });
  appendFileSync(target, "not-json-at-all\n");
  const usage = readClaudeUsage(target);
  assert.equal(usage?.inputTokens, 5);
  rmSync(dir, { recursive: true, force: true });
});

test("an undefined transcriptPath yields null immediately", () => {
  assert.equal(readClaudeUsage(undefined), null);
});

test("tailLines limits summation to the trailing N records", () => {
  const dir = tempDir();
  const target = join(dir, "transcript.jsonl");
  appendRecord(target, { message: { usage: { input_tokens: 1000, output_tokens: 1000 } } });
  appendRecord(target, { message: { usage: { input_tokens: 5, output_tokens: 5 } } });
  const usage = readClaudeUsage(target, 1);
  assert.equal(usage?.inputTokens, 5);
  assert.equal(usage?.outputTokens, 5);
  rmSync(dir, { recursive: true, force: true });
});

test("a non-object record line is ignored rather than throwing", () => {
  const dir = tempDir();
  const target = join(dir, "transcript.jsonl");
  appendRecord(target, 42);
  appendRecord(target, { message: { usage: { input_tokens: 7, output_tokens: 3 } } });
  const usage = readClaudeUsage(target);
  assert.equal(usage?.inputTokens, 7);
  rmSync(dir, { recursive: true, force: true });
});
