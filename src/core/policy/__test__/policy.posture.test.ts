import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { flagsDir, projectStateDir } from "../../../platform/paths.ts";
import { DEFAULT_POSTURE, isOperatorMode, OPERATOR_MODES, resolvePosture } from "../policy.posture.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "tlc-posture-"));
  roots.push(root);
  mkdirSync(projectStateDir(root), { recursive: true });
  return root;
}

function writeModeFile(root: string, value: string): void {
  writeFileSync(join(projectStateDir(root), "harness-mode"), value, "utf8");
}

function writeFlag(root: string, name: string): void {
  mkdirSync(flagsDir(root), { recursive: true });
  writeFileSync(join(flagsDir(root), name), "", "utf8");
}

test("there are exactly three postures and solo is the default", () => {
  assert.deepEqual([...OPERATOR_MODES], ["paired", "solo", "focus"]);
  assert.equal(DEFAULT_POSTURE, "solo");
});

test("only the three words are postures", () => {
  for (const value of OPERATOR_MODES) {
    assert.equal(isOperatorMode(value), true, value);
  }
  // hazard: the second spelling is what let a documented word reach the loader unvalidated. It is not a posture.
  for (const value of ["heads-down", "heads", "Focus", "", " solo", 42, null, undefined, {}, ["solo"]]) {
    assert.equal(isOperatorMode(value), false, JSON.stringify(value));
  }
});

test("a valid config value is applied and reported as coming from config", () => {
  const root = newRoot();
  assert.deepEqual(resolvePosture(root, "focus"), { mode: "focus", origin: "config" });
  assert.deepEqual(resolvePosture(root, "paired"), { mode: "paired", origin: "config" });
});

test("an absent value is the default and is not a fault", () => {
  const root = newRoot();
  for (const absent of [undefined, null]) {
    const resolved = resolvePosture(root, absent);
    assert.equal(resolved.mode, DEFAULT_POSTURE);
    assert.equal(resolved.origin, "config");
    assert.equal(resolved.invalid, undefined, "an absent value has nothing to report");
  }
});

// hazard: this is the measured bug. The value was applied verbatim, matched no branch, and the posture line
// vanished from the bootstrap with no message. It must fall back AND be named.
test("an unusable value falls back and is named", () => {
  const root = newRoot();
  for (const [written, reported] of [
    ["heads-down", "heads-down"],
    ["focsu", "focsu"],
    [42, "42"],
    [true, "true"],
  ] as const) {
    const resolved = resolvePosture(root, written);
    assert.equal(resolved.mode, DEFAULT_POSTURE, String(written));
    assert.equal(resolved.origin, "fallback", String(written));
    assert.equal(resolved.invalid, reported, String(written));
  }
});

test("the mode state file outranks config", () => {
  const root = newRoot();
  writeModeFile(root, "paired");
  assert.deepEqual(resolvePosture(root, "focus"), { mode: "paired", origin: "file" });
});

test("the mode state file is read case- and whitespace-insensitively", () => {
  const root = newRoot();
  writeModeFile(root, "  FOCUS \n");
  assert.deepEqual(resolvePosture(root, "solo"), { mode: "focus", origin: "file" });
});

test("an unusable mode file falls through to config rather than becoming a fault", () => {
  // why: the file is harness-written state, not something an operator typed. A corrupt one means "no answer
  // here", and config is the next authority — reporting it as the operator's mistake would misdirect them.
  const root = newRoot();
  writeModeFile(root, "sideways");
  assert.deepEqual(resolvePosture(root, "focus"), { mode: "focus", origin: "config" });
});

test("posture flag files outrank config and are reported as flags", () => {
  const focusRoot = newRoot();
  writeFlag(focusRoot, "focus");
  assert.deepEqual(resolvePosture(focusRoot, "solo"), { mode: "focus", origin: "flag" });

  const pairedRoot = newRoot();
  writeFlag(pairedRoot, "paired");
  assert.deepEqual(resolvePosture(pairedRoot, "solo"), { mode: "paired", origin: "flag" });
});

test("the deeper flag wins when both are present", () => {
  const root = newRoot();
  writeFlag(root, "focus");
  writeFlag(root, "paired");
  assert.equal(resolvePosture(root, "solo").mode, "focus");
});

test("the mode file outranks a flag", () => {
  const root = newRoot();
  writeFlag(root, "focus");
  writeModeFile(root, "paired");
  assert.deepEqual(resolvePosture(root, "solo"), { mode: "paired", origin: "file" });
});

test("an unusable config value still loses to a flag, and is not reported", () => {
  // why: the flag answered, so nothing fell back — there is no fault to surface.
  const root = newRoot();
  writeFlag(root, "paired");
  assert.deepEqual(resolvePosture(root, "heads-down"), { mode: "paired", origin: "flag" });
});
