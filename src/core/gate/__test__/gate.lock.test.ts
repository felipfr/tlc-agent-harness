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
  isLockReclaimable,
  isLockStale,
  isLockUnreadable,
  isUsableLockBody,
  readLockBody,
  releaseLock,
  withGateLock,
} from "../gate.lock.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-gate-lock-"));
}

function writeCorruptLock(root: string, text: string, ageMs = 0): string {
  const path = gateLockPath(root);
  mkdirSync(join(root, ".tlc", "harness", "state"), { recursive: true });
  writeFileSync(path, text);
  if (ageMs > 0) {
    const past = new Date(Date.now() - ageMs);
    utimesSync(path, past, past);
  }
  return path;
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

// hazard: a lock whose body cannot be read has no owner to wait for and no pid to release it. Before this
// case it was only reclaimed by mtime, so a recent corrupt file cost every stop the full waitMs — measured
// at 120 s in production — and then abstained with an adapter error.
test("withGateLock reclaims an unreadable lock instead of waiting out the deadline", async () => {
  const root = tempRoot();
  try {
    const path = writeCorruptLock(root, "{ this is not json", 10_000);
    assert.equal(readLockBody(path), null);
    let ran = false;
    await withGateLock(
      root,
      "provider-new",
      "session-new",
      async () => {
        ran = true;
      },
      { waitMs: 50, staleMs: 30 * 60 * 1000, unreadableGraceMs: 5_000, sleep: async () => {} },
    );
    assert.equal(ran, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a zero-length lock past the grace window is reclaimed too", async () => {
  const root = tempRoot();
  try {
    writeCorruptLock(root, "", 10_000);
    let ran = false;
    await withGateLock(
      root,
      "p",
      "s",
      async () => {
        ran = true;
      },
      { waitMs: 50, unreadableGraceMs: 5_000, sleep: async () => {} },
    );
    assert.equal(ran, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// hazard: tryAcquire creates the file before writing its body, so an unreadable lock younger than the grace
// window may be a legitimate one mid-write. Stealing it would let two gates run at once.
test("an unreadable lock inside the grace window is left alone", async () => {
  const root = tempRoot();
  try {
    writeCorruptLock(root, "", 100);
    let error: unknown;
    try {
      await withGateLock(root, "p", "s", async () => {}, {
        waitMs: 30,
        unreadableGraceMs: 5_000,
        sleep: async () => {},
      });
    } catch (err) {
      error = err;
    }
    assert.ok(error instanceof GateLockTimeoutError);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("isLockUnreadable separates absent, readable and unreadable locks", () => {
  const root = tempRoot();
  try {
    const now = Date.now();
    assert.equal(isLockUnreadable(gateLockPath(root), { now, graceMs: 1_000 }), false);
    writeRawLock(root, { provider: "p", session: "s", pid: 1, acquired_at: "x" }, 10_000);
    assert.equal(isLockUnreadable(gateLockPath(root), { now, graceMs: 1_000 }), false);
    writeCorruptLock(root, "{ broken", 10_000);
    assert.equal(isLockUnreadable(gateLockPath(root), { now, graceMs: 1_000 }), true);
    assert.equal(isLockUnreadable(gateLockPath(root), { now, graceMs: 60_000 }), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("isLockReclaimable is true for a stale readable lock and for an unreadable one", () => {
  const root = tempRoot();
  try {
    const now = Date.now();
    const args = { now, staleMs: 30 * 60 * 1000, graceMs: 5_000 };
    writeRawLock(root, { provider: "p", session: "s", pid: 1, acquired_at: "x" }, 60_000);
    assert.equal(isLockReclaimable(gateLockPath(root), args), false);
    writeRawLock(root, { provider: "p", session: "s", pid: 1, acquired_at: "x" }, 40 * 60 * 1000);
    assert.equal(isLockReclaimable(gateLockPath(root), args), true);
    writeCorruptLock(root, "{ broken", 10_000);
    assert.equal(isLockReclaimable(gateLockPath(root), args), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// hazard: JSON.parse succeeds on a bare string, a number and an object with none of the fields. Each parses
// but names no holder, so treating "parsed" as "usable" left the same 120 s wait behind a valid-JSON file.
test("a body that parses but names no holder is reclaimed like a corrupt one", async () => {
  for (const shape of ['"just a string"', "42", "{}", '{"provider":"p"}', "null", "[]"]) {
    const root = tempRoot();
    try {
      writeCorruptLock(root, shape, 10_000);
      assert.equal(describeHolder(root), null, `describeHolder should name nobody for ${shape}`);
      let ran = false;
      await withGateLock(
        root,
        "p",
        "s",
        async () => {
          ran = true;
        },
        { waitMs: 30, unreadableGraceMs: 5_000, sleep: async () => {} },
      );
      assert.equal(ran, true, `withGateLock should reclaim ${shape}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("isUsableLockBody accepts a real body and rejects every malformed shape", () => {
  assert.equal(isUsableLockBody({ provider: "p", session: "s", pid: 1, acquired_at: "x" }), true);
  for (const shape of [
    null,
    undefined,
    "s",
    42,
    [],
    {},
    { provider: "p" },
    { provider: "p", session: "s" },
  ]) {
    assert.equal(isUsableLockBody(shape), false, `should reject ${JSON.stringify(shape)}`);
  }
});
