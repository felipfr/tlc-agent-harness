import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkCollision, presenceSessionKey, readPresenceRecord } from "../presence.service.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const REGISTER = join(FIXTURES, "register-presence-once.ts");
const REGISTER_BRANCH = join(FIXTURES, "register-presence-branch.ts");

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-presence-concurrency-"));
}

function runFixture(script: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: "inherit" });
    const pid = child.pid;
    child.on("exit", (code) => {
      if (code === 0 && pid !== undefined) {
        resolve(pid);
      } else {
        reject(new Error(`${script} exited with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

test("two concurrently-spawned processes each see the other's live presence and never their own", async () => {
  const root = tempRoot();
  try {
    await Promise.all([
      runFixture(REGISTER, [root, "provider-a", "session-a", "src/shared.ts"]),
      runFixture(REGISTER, [root, "provider-b", "session-b", "src/shared.ts"]),
    ]);

    const fromA = checkCollision(root, "src/shared.ts", presenceSessionKey("provider-a", "session-a"));
    assert.equal(fromA.kind, "ask");
    if (fromA.kind === "ask") {
      assert.match(fromA.reason, /provider-b/);
    }

    const fromB = checkCollision(root, "src/shared.ts", presenceSessionKey("provider-b", "session-b"));
    assert.equal(fromB.kind, "ask");
    if (fromB.kind === "ask") {
      assert.match(fromB.reason, /provider-a/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("two processes racing register() for the same session leave one valid, uncorrupted record that still never collides with itself", async () => {
  const root = tempRoot();
  try {
    const [pidX, pidY] = await Promise.all([
      runFixture(REGISTER_BRANCH, [root, "provider-a", "session-a", "branch-x"]),
      runFixture(REGISTER_BRANCH, [root, "provider-a", "session-a", "branch-y"]),
    ]);

    const record = readPresenceRecord(root, "provider-a", "session-a");
    assert.ok(record, "the record must remain valid JSON after the race");
    assert.ok(record?.pid === pidX || record?.pid === pidY);
    assert.ok(record?.branch === "branch-x" || record?.branch === "branch-y");

    const decision = checkCollision(root, "src/anything.ts", presenceSessionKey("provider-a", "session-a"));
    assert.equal(decision.kind, "allow");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
