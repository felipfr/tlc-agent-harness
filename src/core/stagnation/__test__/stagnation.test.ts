import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { computeFingerprint } from "../stagnation.service.ts";
import { clearFingerprint, fingerprintHits, trackFingerprint } from "../stagnation.store.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-stagnation-"));
}

test("computeFingerprint is deterministic for identical input", () => {
  const parts = { files: ["a.ts"], gate: "lint", exitCode: 1, output: "error" };
  assert.equal(computeFingerprint(parts), computeFingerprint(parts));
});

test("computeFingerprint normalizes timestamps so they do not change the signature", () => {
  const a = computeFingerprint({
    files: ["a.ts"],
    gate: "test",
    exitCode: 1,
    output: "failed at 2026-07-29T10:00:00.000Z",
  });
  const b = computeFingerprint({
    files: ["a.ts"],
    gate: "test",
    exitCode: 1,
    output: "failed at 2026-07-29T11:30:05.123Z",
  });
  assert.equal(a, b);
});

test("computeFingerprint normalizes long numbers so they do not change the signature", () => {
  const a = computeFingerprint({ files: [], gate: "test", exitCode: 1, output: "pid 123456" });
  const b = computeFingerprint({ files: [], gate: "test", exitCode: 1, output: "pid 987654" });
  assert.equal(a, b);
});

test("computeFingerprint differs when the gate differs", () => {
  const a = computeFingerprint({ files: [], gate: "lint", exitCode: 1, output: "x" });
  const b = computeFingerprint({ files: [], gate: "test", exitCode: 1, output: "x" });
  assert.notEqual(a, b);
});

test("the first trackFingerprint call for a session returns 1 hit", () => {
  const root = tempRoot();
  try {
    assert.equal(trackFingerprint(root, "session-a", "fp-1"), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("repeating the same fingerprint increments the hit count", () => {
  const root = tempRoot();
  try {
    trackFingerprint(root, "session-a", "fp-1");
    trackFingerprint(root, "session-a", "fp-1");
    assert.equal(trackFingerprint(root, "session-a", "fp-1"), 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a different fingerprint resets the hit count to 1", () => {
  const root = tempRoot();
  try {
    trackFingerprint(root, "session-a", "fp-1");
    trackFingerprint(root, "session-a", "fp-1");
    assert.equal(trackFingerprint(root, "session-a", "fp-2"), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recording a fingerprint under session A leaves session B's hit count at zero", () => {
  const root = tempRoot();
  try {
    trackFingerprint(root, "session-a", "fp-1");
    trackFingerprint(root, "session-a", "fp-1");
    assert.equal(fingerprintHits(root, "session-b"), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fingerprintHits returns 0 for a session with no record", () => {
  const root = tempRoot();
  try {
    assert.equal(fingerprintHits(root, "unseen"), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("clearFingerprint clears only the given session", () => {
  const root = tempRoot();
  try {
    trackFingerprint(root, "session-a", "fp-1");
    trackFingerprint(root, "session-b", "fp-1");
    clearFingerprint(root, "session-a");
    assert.equal(fingerprintHits(root, "session-a"), 0);
    assert.equal(fingerprintHits(root, "session-b"), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("clearFingerprint on a session never tracked does not throw", () => {
  const root = tempRoot();
  try {
    assert.doesNotThrow(() => clearFingerprint(root, "never-tracked"));
    assert.equal(fingerprintHits(root, "never-tracked"), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
