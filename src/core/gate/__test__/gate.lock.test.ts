import assert from "node:assert/strict";
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { nextDelay } from "../../../platform/backoff.ts";
import {
  describeHolder,
  GateLockTimeoutError,
  gateLockPath,
  isLockStale,
  readLockBody,
  releaseLock,
  withGateLock,
} from "../gate.lock.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-gate-lock-"));
}

function writeRawLock(root: string, body: unknown, ageMs = 0): string {
  const path = gateLockPath(root);
  mkdirSync(join(root, ".tlc", "harness", "state"), { recursive: true });
  writeFileSync(path, JSON.stringify(body));
  if (ageMs > 0) {
    const past = new Date(Date.now() - ageMs);
    utimesSync(path, past, past);
  }
  return path;
}

test("withGateLock writes a JSON body of {provider, session, pid, acquired_at}", async () => {
  const root = tempRoot();
  try {
    let observed: unknown;
    await withGateLock(root, "provider-a", "session-1", async () => {
      observed = readLockBody(gateLockPath(root));
    });
    const body = observed as { provider: string; session: string; pid: number; acquired_at: string };
    assert.equal(body.provider, "provider-a");
    assert.equal(body.session, "session-1");
    assert.equal(body.pid, process.pid);
    assert.equal(typeof body.acquired_at, "string");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("withGateLock releases the lock file after the critical section", async () => {
  const root = tempRoot();
  try {
    await withGateLock(root, "provider-a", "session-1", async () => {});
    assert.equal(readLockBody(gateLockPath(root)), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("describeHolder names the holding provider and session", () => {
  const root = tempRoot();
  try {
    writeRawLock(root, { provider: "provider-b", session: "session-9", pid: 4242, acquired_at: "x" });
    assert.equal(describeHolder(root), "provider-b session session-9 (pid 4242)");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("describeHolder returns null when nothing holds the lock", () => {
  const root = tempRoot();
  try {
    assert.equal(describeHolder(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// hazard: the stop path short-circuits on this answer before withGateLock can reach stealIfStale, so a
// holder still reported past the threshold blocks the grind for as long as the abandoned file survives.
test("describeHolder returns null once the lock is past the stale threshold", () => {
  const root = tempRoot();
  try {
    writeRawLock(
      root,
      { provider: "provider-dead", session: "dead-session", pid: 999_999, acquired_at: "x" },
      40 * 60 * 1000,
    );
    assert.equal(describeHolder(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("describeHolder still names a holder inside the stale threshold", () => {
  const root = tempRoot();
  try {
    writeRawLock(
      root,
      { provider: "provider-live", session: "live-session", pid: 4242, acquired_at: "x" },
      60_000,
    );
    assert.equal(describeHolder(root), "provider-live session live-session (pid 4242)");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("describeHolder honours an explicit staleMs so callers can tighten the window", () => {
  const root = tempRoot();
  try {
    writeRawLock(root, { provider: "p", session: "s", pid: 1, acquired_at: "x" }, 5_000);
    assert.equal(describeHolder(root, { staleMs: 1_000 }), null);
    assert.equal(describeHolder(root, { staleMs: 60_000 }), "p session s (pid 1)");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("isLockStale is false below the threshold and true at or above it", () => {
  const root = tempRoot();
  try {
    const path = writeRawLock(root, { provider: "provider-a", session: "s", pid: 1, acquired_at: "x" }, 1000);
    assert.equal(isLockStale(path, { now: Date.now(), staleMs: 2000 }), false);
    assert.equal(isLockStale(path, { now: Date.now(), staleMs: 900 }), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("isLockStale is false when the lock does not exist", () => {
  const root = tempRoot();
  try {
    assert.equal(isLockStale(gateLockPath(root), { now: Date.now(), staleMs: 100 }), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("withGateLock steals a stale lock and reports the previous holder", async () => {
  const root = tempRoot();
  try {
    writeRawLock(
      root,
      { provider: "provider-old", session: "stale-session", pid: 999_999, acquired_at: "x" },
      60_000,
    );
    let stolenFrom: string | undefined;
    let ran = false;
    await withGateLock(
      root,
      "provider-new",
      "session-new",
      async () => {
        ran = true;
      },
      { staleMs: 30_000, onSteal: (previous) => (stolenFrom = previous.provider) },
    );
    assert.equal(ran, true);
    assert.equal(stolenFrom, "provider-old");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("withGateLock times out and names the holder when the lock stays busy", async () => {
  const root = tempRoot();
  try {
    const path = gateLockPath(root);
    mkdirSync(join(root, ".tlc", "harness", "state"), { recursive: true });
    const fd = openSync(path, "wx");
    closeSync(fd);
    writeFileSync(
      path,
      JSON.stringify({ provider: "provider-busy", session: "s", pid: 1, acquired_at: "x" }),
    );

    let error: unknown;
    try {
      await withGateLock(root, "provider-waiter", "session-waiter", async () => {}, {
        waitMs: 30,
        staleMs: 60 * 60 * 1000,
        sleep: async () => {},
      });
    } catch (err) {
      error = err;
    }
    assert.ok(error instanceof GateLockTimeoutError);
    assert.match((error as Error).message, /provider-busy/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("releaseLock only removes the lock when the body's pid matches", () => {
  const root = tempRoot();
  try {
    const path = writeRawLock(root, { provider: "provider-a", session: "s", pid: 111, acquired_at: "x" });
    releaseLock(path, 222);
    assert.notEqual(readLockBody(path), null);
    releaseLock(path, 111);
    assert.equal(readLockBody(path), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("withGateLock's poll delay follows the jittered backoff formula, not a fixed interval", async () => {
  const root = tempRoot();
  try {
    const path = gateLockPath(root);
    mkdirSync(join(root, ".tlc", "harness", "state"), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ provider: "provider-busy", session: "s", pid: 1, acquired_at: "x" }),
    );

    const delays: number[] = [];
    let error: unknown;
    try {
      await withGateLock(root, "provider-waiter", "session-waiter", async () => {}, {
        waitMs: 30,
        staleMs: 60 * 60 * 1000,
        random: () => 0.5,
        baseMs: 10,
        capMs: 100,
        sleep: async (ms) => {
          delays.push(ms);
        },
      });
    } catch (err) {
      error = err;
    }
    assert.ok(error instanceof GateLockTimeoutError);
    assert.ok(delays.length >= 2);
    assert.equal(delays[0], nextDelay({ attempt: 0, baseMs: 10, capMs: 100, random: () => 0.5 }));
    assert.equal(delays[1], nextDelay({ attempt: 1, baseMs: 10, capMs: 100, random: () => 0.5 }));
    assert.notEqual(delays[0], delays[1]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
