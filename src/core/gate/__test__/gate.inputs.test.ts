import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { cachedVerdict, computeInputsHash, isCacheHit } from "../gate.inputs.ts";

const cleanup: string[] = [];

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "tlc-inputs-"));
  cleanup.push(root);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "src", "b.ts"), "export const b = 2;\n");
  return root;
}

afterEach(() => {
  for (const root of cleanup.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const CMD = ["npm", "test"];

test("the same tree and command hash the same", () => {
  const root = newRoot();
  const first = computeInputsHash(root, ["src/a.ts", "src/b.ts"], CMD);
  const second = computeInputsHash(root, ["src/a.ts", "src/b.ts"], CMD);
  assert.equal(first.hash, second.hash);
  assert.equal(first.complete, true);
});

test("the file order does not change the hash", () => {
  const root = newRoot();
  assert.equal(
    computeInputsHash(root, ["src/a.ts", "src/b.ts"], CMD).hash,
    computeInputsHash(root, ["src/b.ts", "src/a.ts"], CMD).hash,
  );
});

test("a duplicate path does not change the hash", () => {
  const root = newRoot();
  assert.equal(
    computeInputsHash(root, ["src/a.ts"], CMD).hash,
    computeInputsHash(root, ["src/a.ts", "src/a.ts"], CMD).hash,
  );
});

test("a content change changes the hash", () => {
  const root = newRoot();
  const before = computeInputsHash(root, ["src/a.ts"], CMD);
  writeFileSync(join(root, "src", "a.ts"), "export const a = 99;\n");
  assert.notEqual(computeInputsHash(root, ["src/a.ts"], CMD).hash, before.hash);
});

// why: contents rather than mtime. A touch, a branch switch that restores identical bytes, or a clock that moved
// all change mtime without changing anything the gate would read.
test("a touch that changes only mtime does not change the hash", () => {
  const root = newRoot();
  const before = computeInputsHash(root, ["src/a.ts"], CMD);
  const future = new Date(Date.now() + 60_000);
  utimesSync(join(root, "src", "a.ts"), future, future);
  assert.equal(computeInputsHash(root, ["src/a.ts"], CMD).hash, before.hash);
});

test("the command is part of the key", () => {
  const root = newRoot();
  assert.notEqual(
    computeInputsHash(root, ["src/a.ts"], ["npm", "test"]).hash,
    computeInputsHash(root, ["src/a.ts"], ["npm", "run", "test"]).hash,
  );
});

test("an empty file list still hashes, because the command is the rest of the key", () => {
  const root = newRoot();
  const empty = computeInputsHash(root, [], CMD);
  assert.equal(empty.complete, true);
  assert.ok(empty.hash.length > 0);
  assert.notEqual(empty.hash, computeInputsHash(root, [], ["npm", "run", "lint"]).hash);
});

// invariant: unknown means run the gate. An unreadable input must never be reported as a match.
test("a missing file makes the result incomplete", () => {
  const root = newRoot();
  const result = computeInputsHash(root, ["src/gone.ts"], CMD);
  assert.equal(result.complete, false);
  assert.equal(isCacheHit(result, result.hash), false);
});

test("a directory in the file list makes the result incomplete", () => {
  const root = newRoot();
  assert.equal(computeInputsHash(root, ["src"], CMD).complete, false);
});

// hazard: an absolute path would resolve against the machine, so the same tree would hash differently depending
// on where it was checked out.
test("an absolute path makes the result incomplete", () => {
  const root = newRoot();
  assert.equal(computeInputsHash(root, [join(root, "src", "a.ts")], CMD).complete, false);
});

test("too many files makes the result incomplete rather than slow", () => {
  const root = newRoot();
  const many = Array.from({ length: 401 }, (_, index) => `src/f${index}.ts`);
  assert.equal(computeInputsHash(root, many, CMD).complete, false);
});

test("a total byte budget overrun makes the result incomplete", () => {
  const root = newRoot();
  writeFileSync(join(root, "src", "huge.ts"), "x".repeat(12_000_001));
  assert.equal(computeInputsHash(root, ["src/huge.ts"], CMD).complete, false);
});

test("a matching complete hash is a cache hit", () => {
  const root = newRoot();
  const inputs = computeInputsHash(root, ["src/a.ts"], CMD);
  assert.equal(isCacheHit(inputs, inputs.hash), true);
});

// invariant: an artifact written before the field existed has no hash, so the first run after an upgrade executes.
test("an absent recorded hash is never a cache hit", () => {
  const root = newRoot();
  const inputs = computeInputsHash(root, ["src/a.ts"], CMD);
  assert.equal(isCacheHit(inputs, undefined), false);
  assert.equal(isCacheHit(inputs, ""), false);
});

test("a different recorded hash is not a cache hit", () => {
  const root = newRoot();
  const inputs = computeInputsHash(root, ["src/a.ts"], CMD);
  assert.equal(isCacheHit(inputs, "deadbeef"), false);
});

/**
 * hazard: end to end the gate name check is unfalsifiable, because the command is part of the key and two gates
 * cannot produce the same hash. It is tested here so the guard is load-bearing rather than decoration.
 */
test("a verdict from a different gate is never reused, even on an identical hash", () => {
  const root = newRoot();
  const inputs = computeInputsHash(root, ["src/a.ts"], CMD);
  const artifact = { gate: "lint", inputsHash: inputs.hash };
  assert.equal(cachedVerdict(artifact, "lint", inputs), artifact);
  assert.equal(cachedVerdict(artifact, "test", inputs), null);
});

test("no previous artifact means run the gate", () => {
  const root = newRoot();
  assert.equal(cachedVerdict(null, "lint", computeInputsHash(root, ["src/a.ts"], CMD)), null);
});

test("an artifact with no recorded hash means run the gate", () => {
  const root = newRoot();
  const inputs = computeInputsHash(root, ["src/a.ts"], CMD);
  assert.equal(cachedVerdict({ gate: "lint" }, "lint", inputs), null);
});

/**
 * hazard: an incomplete hash is computed over the entries it *could* read, so `[a, missing]` hashes over `[a]` —
 * exactly what `[a]` alone hashes to. Recording it would let a complete run collide with an incomplete one and
 * reuse a verdict produced without seeing every input ([/decisions/ad-045.md](/decisions/ad-045.md)).
 */
test("an incomplete hash collides with a complete one over the readable subset", () => {
  const root = newRoot();
  const incomplete = computeInputsHash(root, ["src/a.ts", "src/gone.ts"], CMD);
  const complete = computeInputsHash(root, ["src/a.ts"], CMD);
  assert.equal(incomplete.complete, false);
  assert.equal(complete.complete, true);
  assert.equal(incomplete.hash, complete.hash, "the collision is real, which is why it must not be recorded");
  // why: proving the danger — a recorded incomplete hash *would* be reused by a later complete run.
  assert.notEqual(cachedVerdict({ gate: "lint", inputsHash: incomplete.hash }, "lint", complete), null);
});
