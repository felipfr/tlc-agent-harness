import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readHandoffFile } from "../handoff.store.ts";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "patch-handoff-once.ts");

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-handoff-concurrency-"));
}

function runPatcher(root: string, provider: string, patch: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [FIXTURE, root, provider, JSON.stringify(patch)], {
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`patch-handoff-once exited with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

test("two concurrent writers under different providers both survive with no clobbering", async () => {
  const root = tempRoot();
  try {
    await Promise.all([
      runPatcher(root, "provider-a", { slice: { next_action: "a-action" } }),
      runPatcher(root, "provider-b", { slice: { next_action: "b-action" } }),
    ]);

    const file = readHandoffFile(root);
    assert.equal(file.by_provider["provider-a"]?.next_action, "a-action");
    assert.equal(file.by_provider["provider-b"]?.next_action, "b-action");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("two concurrent writers under the same provider merge without losing either field", async () => {
  const root = tempRoot();
  try {
    await Promise.all([
      runPatcher(root, "provider-a", { slice: { next_action: "run tests" } }),
      runPatcher(root, "provider-a", { slice: { blockers: "flaky ci" } }),
    ]);

    const file = readHandoffFile(root);
    const slice = file.by_provider["provider-a"];
    assert.equal(slice?.next_action, "run tests");
    assert.equal(slice?.blockers, "flaky ci");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent writers touching shared while writing distinct slices leave the file valid and both slices intact", async () => {
  const root = tempRoot();
  try {
    await Promise.all([
      runPatcher(root, "provider-a", {
        shared: { git_branch: "main" },
        slice: { next_action: "a-action" },
      }),
      runPatcher(root, "provider-b", {
        shared: { project_name: "demo" },
        slice: { next_action: "b-action" },
      }),
    ]);

    const file = readHandoffFile(root);
    assert.equal(file.schema, "harness.handoff.v2");
    assert.equal(file.by_provider["provider-a"]?.next_action, "a-action");
    assert.equal(file.by_provider["provider-b"]?.next_action, "b-action");
    assert.equal(file.shared.git_branch, "main");
    assert.equal(file.shared.project_name, "demo");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
