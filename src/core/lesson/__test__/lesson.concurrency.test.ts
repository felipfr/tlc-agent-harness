import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readProjectLessons } from "../lesson.store.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-lesson-concurrency-"));
}

function runChild(script: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(FIXTURES, script), ...args], { stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${script} exited with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

test("two processes each adding a distinct lesson via upsertProjectLesson both survive", async () => {
  const root = tempRoot();
  try {
    await Promise.all([
      runChild("upsert-lesson-once.ts", [root, "project:test:a"]),
      runChild("upsert-lesson-once.ts", [root, "project:test:b"]),
    ]);

    const stored = readProjectLessons(root);
    const ids = stored.map((l) => l.id).sort();
    assert.deepEqual(ids, ["project:test:a", "project:test:b"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("two processes recording distinct failures concurrently both persist their lesson", async () => {
  const root = tempRoot();
  try {
    await Promise.all([
      runChild("record-failure-once.ts", [root, "lint", "fp-a"]),
      runChild("record-failure-once.ts", [root, "test", "fp-b"]),
    ]);

    const stored = readProjectLessons(root);
    assert.equal(stored.length, 2);
    assert.ok(stored.some((l) => l.failedGate === "lint"));
    assert.ok(stored.some((l) => l.failedGate === "test"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
