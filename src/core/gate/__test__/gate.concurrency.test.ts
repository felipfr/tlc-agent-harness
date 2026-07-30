import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gateLockPath, readLockBody } from "../gate.lock.ts";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "hold-gate-lock.ts");

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-gate-concurrency-"));
}

function runHolder(
  root: string,
  provider: string,
  session: string,
  holdMs: number,
  logPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [FIXTURE, root, provider, session, String(holdMs), logPath], {
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`hold-gate-lock exited with code ${code}`));
      }
    });
    child.on("error", reject);
  });
}

function parseIntervals(logPath: string): Record<string, { start: number; end: number }> {
  const lines = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
  const intervals: Record<string, { start: number; end: number }> = {};
  for (const line of lines) {
    const [provider, kind, ts] = line.split(" ");
    if (!provider || !kind || !ts) {
      continue;
    }
    const entry = intervals[provider] ?? { start: 0, end: 0 };
    if (kind === "start") {
      entry.start = Number(ts);
    } else {
      entry.end = Number(ts);
    }
    intervals[provider] = entry;
  }
  return intervals;
}

test("two concurrent acquirers never enter the critical section at the same time", async () => {
  const root = tempRoot();
  const logPath = join(root, "log.txt");
  writeFileSync(logPath, "");
  try {
    await Promise.all([
      runHolder(root, "provider-a", "session-a", 80, logPath),
      runHolder(root, "provider-b", "session-b", 80, logPath),
    ]);

    const intervals = parseIntervals(logPath);
    const a = intervals["provider-a"];
    const b = intervals["provider-b"];
    assert.ok(a && b);
    const overlap = a && b ? a.start < b.end && b.start < a.end : true;
    assert.equal(overlap, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("two concurrent acquirers both eventually enter, and no lock is left behind", async () => {
  const root = tempRoot();
  const logPath = join(root, "log.txt");
  writeFileSync(logPath, "");
  try {
    await Promise.all([
      runHolder(root, "provider-a", "session-a", 30, logPath),
      runHolder(root, "provider-b", "session-b", 30, logPath),
    ]);

    const lines = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 4);
    assert.equal(readLockBody(gateLockPath(root)), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
