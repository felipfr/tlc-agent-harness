import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { appendRecord, readTail } from "../fs-jsonl.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "fs-jsonl-test-"));
}

describe("appendRecord", () => {
  test("creates parent directories that do not exist", () => {
    const dir = tempDir();
    const target = join(dir, "nested", "deep", "log.jsonl");
    appendRecord(target, { a: 1 });
    assert.equal(existsSync(target), true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("writes exactly one newline-terminated line per call", () => {
    const dir = tempDir();
    const target = join(dir, "log.jsonl");
    appendRecord(target, { a: 1 });
    appendRecord(target, { a: 2 });
    const content = readFileSync(target, "utf8");
    assert.equal(content, '{"a":1}\n{"a":2}\n');
    rmSync(dir, { recursive: true, force: true });
  });

  test("preserves insertion order across multiple appends", () => {
    const dir = tempDir();
    const target = join(dir, "log.jsonl");
    appendRecord(target, { seq: 1 });
    appendRecord(target, { seq: 2 });
    appendRecord(target, { seq: 3 });
    assert.deepEqual(readTail<{ seq: number }>(target, 10), [{ seq: 1 }, { seq: 2 }, { seq: 3 }]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("readTail", () => {
  test("returns the last n parseable records in file order", () => {
    const dir = tempDir();
    const target = join(dir, "log.jsonl");
    for (let i = 1; i <= 5; i++) {
      appendRecord(target, { seq: i });
    }
    assert.deepEqual(readTail<{ seq: number }>(target, 2), [{ seq: 4 }, { seq: 5 }]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("skips a truncated final line and returns earlier valid records", () => {
    const dir = tempDir();
    const target = join(dir, "log.jsonl");
    appendRecord(target, { seq: 1 });
    appendRecord(target, { seq: 2 });
    appendFileSync(target, '{"seq":3,"trunca');
    assert.deepEqual(readTail<{ seq: number }>(target, 10), [{ seq: 1 }, { seq: 2 }]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("skips a malformed final line and returns earlier valid records", () => {
    const dir = tempDir();
    const target = join(dir, "log.jsonl");
    appendRecord(target, { seq: 1 });
    appendFileSync(target, "not-json-at-all\n");
    assert.deepEqual(readTail<{ seq: number }>(target, 10), [{ seq: 1 }]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns an empty array for a missing file", () => {
    const dir = tempDir();
    const target = join(dir, "does-not-exist.jsonl");
    assert.deepEqual(readTail(target, 5), []);
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns all available records when n exceeds the record count", () => {
    const dir = tempDir();
    const target = join(dir, "log.jsonl");
    appendRecord(target, { seq: 1 });
    appendRecord(target, { seq: 2 });
    assert.deepEqual(readTail<{ seq: number }>(target, 100), [{ seq: 1 }, { seq: 2 }]);
    rmSync(dir, { recursive: true, force: true });
  });
});
