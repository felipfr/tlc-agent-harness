import assert from "node:assert/strict";
import { test } from "node:test";
import { emitJson, takeJsonFlag, unknownFlags } from "../cli-output.ts";

test("takeJsonFlag reports absence and leaves the arguments untouched", () => {
  const result = takeJsonFlag(["report", "--limit", "5"]);
  assert.equal(result.json, false);
  assert.deepEqual(result.rest, ["report", "--limit", "5"]);
});

test("takeJsonFlag strips the flag from any position", () => {
  assert.deepEqual(takeJsonFlag(["--json", "report"]), { json: true, rest: ["report"] });
  assert.deepEqual(takeJsonFlag(["report", "--json"]), { json: true, rest: ["report"] });
  assert.deepEqual(takeJsonFlag(["obs", "--json", "report"]), { json: true, rest: ["obs", "report"] });
});

test("takeJsonFlag strips every repetition rather than leaving a duplicate behind", () => {
  assert.deepEqual(takeJsonFlag(["--json", "x", "--json"]), { json: true, rest: ["x"] });
});

test("takeJsonFlag does not match a flag that merely starts with the same characters", () => {
  const result = takeJsonFlag(["--jsonl", "--stdin-json"]);
  assert.equal(result.json, false);
  assert.deepEqual(result.rest, ["--jsonl", "--stdin-json"]);
});

test("emitJson writes a single line holding one parseable value", () => {
  const written: string[] = [];
  emitJson({ ok: true, checks: [] }, (text) => written.push(text));
  assert.equal(written.length, 1);
  const line = written[0] ?? "";
  assert.ok(line.endsWith("\n"));
  assert.equal(line.split("\n").filter((part) => part.length > 0).length, 1);
  assert.deepEqual(JSON.parse(line), { ok: true, checks: [] });
});

test("unknownFlags names leftover flags so a caller can refuse them", () => {
  assert.deepEqual(unknownFlags(["status", "--wat", "-x"]), ["--wat"]);
  assert.deepEqual(unknownFlags(["status"]), []);
});
