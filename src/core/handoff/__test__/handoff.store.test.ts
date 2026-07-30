import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { handoffPath, patchHandoff, readHandoffFile } from "../handoff.store.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-handoff-"));
}

test("readHandoffFile returns the default v2 shape when no file exists", () => {
  const root = tempRoot();
  try {
    const file = readHandoffFile(root);
    assert.equal(file.schema, "harness.handoff.v2");
    assert.deepEqual(file.by_provider, {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("patchHandoff writes a file matching the v2 schema shape", async () => {
  const root = tempRoot();
  try {
    await patchHandoff(root, "provider-a", { slice: { next_action: "run tests" } });
    const file = readHandoffFile(root);
    assert.equal(file.schema, "harness.handoff.v2");
    assert.ok(file.shared);
    assert.ok(file.by_provider["provider-a"]);
    assert.equal(file.by_provider["provider-a"]?.next_action, "run tests");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("patching under provider A leaves provider B's slice byte-identical", async () => {
  const root = tempRoot();
  try {
    await patchHandoff(root, "provider-b", { slice: { next_action: "b-action", blockers: "b-blocker" } });
    const before = JSON.stringify(readHandoffFile(root).by_provider["provider-b"]);

    await patchHandoff(root, "provider-a", { slice: { next_action: "a-action" } });
    const after = JSON.stringify(readHandoffFile(root).by_provider["provider-b"]);

    assert.equal(after, before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readHandoffFile falls back to the default on malformed JSON", () => {
  const root = tempRoot();
  try {
    const path = handoffPath(root);
    mkdirSync(join(root, ".tlc", "harness", "state"), { recursive: true });
    writeFileSync(path, "{not json");
    const file = readHandoffFile(root);
    assert.equal(file.schema, "harness.handoff.v2");
    assert.deepEqual(file.by_provider, {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readHandoffFile falls back to the default on a legacy v1 shape", () => {
  const root = tempRoot();
  try {
    const path = handoffPath(root);
    mkdirSync(join(root, ".tlc", "harness", "state"), { recursive: true });
    writeFileSync(path, JSON.stringify({ updated_at: "x", mode: "solo", next_action: "old shape" }));
    const file = readHandoffFile(root);
    assert.equal(file.schema, "harness.handoff.v2");
    assert.deepEqual(file.by_provider, {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a second patch to the same provider preserves fields not present in the new patch", async () => {
  const root = tempRoot();
  try {
    await patchHandoff(root, "provider-a", { slice: { next_action: "first", blockers: "still blocked" } });
    await patchHandoff(root, "provider-a", { slice: { next_action: "second" } });
    const slice = readHandoffFile(root).by_provider["provider-a"];
    assert.equal(slice?.next_action, "second");
    assert.equal(slice?.blockers, "still blocked");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
