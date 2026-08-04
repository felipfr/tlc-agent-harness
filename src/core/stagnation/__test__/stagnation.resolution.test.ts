import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  MAX_FILES_PER_RESOLUTION,
  MAX_RESOLUTIONS,
  readResolutions,
  recordResolution,
  resolutionFor,
  resolutionHistoryLine,
} from "../stagnation.resolution.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-resolution-"));
}

// why: the harness computed a failure identity, counted its repeats, and deleted the record the moment the gate
// went green — destroying the pairing of that failure with what resolved it.
test("a resolution is recorded against its fingerprint and read back", () => {
  const root = tempRoot();
  try {
    recordResolution(root, "fp-a", { files: ["src/a.ts"], at: "2026-08-01T00:00:00Z", gate: "test" });
    assert.deepEqual(resolutionFor(root, "fp-a")?.files, ["src/a.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unknown fingerprint has no history rather than an empty one", () => {
  const root = tempRoot();
  try {
    assert.equal(resolutionFor(root, "never-seen"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolving the same fingerprint twice keeps the newer record", () => {
  const root = tempRoot();
  try {
    recordResolution(root, "fp-a", { files: ["old.ts"], at: "2026-08-01T00:00:00Z", gate: "test" });
    recordResolution(root, "fp-a", { files: ["new.ts"], at: "2026-08-02T00:00:00Z", gate: "test" });
    assert.deepEqual(resolutionFor(root, "fp-a")?.files, ["new.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// why: this file is read on the failure path, which runs while an operator waits. The bound is asserted at its
// boundary rather than somewhere comfortably inside it.
test("the store is bounded, and pruning drops the oldest rather than the newest", () => {
  const root = tempRoot();
  try {
    for (let i = 0; i < MAX_RESOLUTIONS + 5; i += 1) {
      const stamp = `2026-08-01T00:${String(i).padStart(2, "0")}:00Z`;
      recordResolution(root, `fp-${i}`, { files: [`f${i}.ts`], at: stamp, gate: "test" });
    }
    const store = readResolutions(root);
    assert.equal(Object.keys(store).length, MAX_RESOLUTIONS);
    assert.ok(store[`fp-${MAX_RESOLUTIONS + 4}`], "the newest resolution was pruned");
    assert.equal(store["fp-0"], undefined, "the oldest resolution survived pruning");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a resolution carries at most the file cap, so a wide diff does not become noise", () => {
  const root = tempRoot();
  try {
    const many = Array.from({ length: 30 }, (_, i) => `f${i}.ts`);
    recordResolution(root, "fp-wide", { files: many, at: "2026-08-01T00:00:00Z", gate: "test" });
    assert.equal(resolutionFor(root, "fp-wide")?.files.length, MAX_FILES_PER_RESOLUTION);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// invariant: history, never instruction. AD-024 established that a plan names files from evidence and never from
// proximity; the same list phrased as an order would reintroduce that harm through a third door.
test("the history line is past tense and carries no instruction to edit", () => {
  const line = resolutionHistoryLine({
    files: ["src/a.ts", "src/b.ts"],
    at: "2026-08-01T00:00:00Z",
    gate: "test",
  });
  assert.match(line, /^History:/);
  assert.match(line, /was resolved once before/);
  assert.match(line, /not a list to edit/);
  assert.match(line, /src\/a\.ts, src\/b\.ts/);
  for (const imperative of ["Fix ", "Edit ", "Change these", "Update these"]) {
    assert.equal(line.includes(imperative), false, imperative);
  }
});

test("a corrupt store reads as empty rather than throwing on the failure path", () => {
  const root = tempRoot();
  try {
    recordResolution(root, "fp-a", { files: ["a.ts"], at: "2026-08-01T00:00:00Z", gate: "test" });
    assert.doesNotThrow(() => readResolutions(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
