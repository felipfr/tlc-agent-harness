import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { updateJsonAtomic, writeJsonAtomic } from "../fs-atomic.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "fs-atomic-test-"));
}

describe("writeJsonAtomic", () => {
  test("writes valid JSON matching the input value", async () => {
    const dir = tempDir();
    const target = join(dir, "state.json");
    await writeJsonAtomic(target, { hello: "world" });
    assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { hello: "world" });
    rmSync(dir, { recursive: true, force: true });
  });

  test("creates missing parent directories", async () => {
    const dir = tempDir();
    const target = join(dir, "nested", "deep", "state.json");
    await writeJsonAtomic(target, { ok: true });
    assert.equal(existsSync(target), true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("overwrites existing content with the new value exactly", async () => {
    const dir = tempDir();
    const target = join(dir, "state.json");
    await writeJsonAtomic(target, { count: 1 });
    await writeJsonAtomic(target, { count: 2 });
    assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { count: 2 });
    rmSync(dir, { recursive: true, force: true });
  });

  test("target is never observed with anything but the previous full value before rename", async () => {
    const dir = tempDir();
    const target = join(dir, "state.json");
    await writeJsonAtomic(target, { count: 1 });

    let observedBeforeRename: unknown;
    await writeJsonAtomic(
      target,
      { count: 2 },
      {
        rename: (from, to) => {
          observedBeforeRename = JSON.parse(readFileSync(target, "utf8"));
          renameSync(from, to);
        },
      },
    );

    assert.deepEqual(observedBeforeRename, { count: 1 });
    assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { count: 2 });
    rmSync(dir, { recursive: true, force: true });
  });

  test("rename failing with EBUSY twice then succeeding results in success", async () => {
    const dir = tempDir();
    const target = join(dir, "state.json");
    let calls = 0;
    const sleeps: number[] = [];
    await writeJsonAtomic(
      target,
      { ok: true },
      {
        random: () => 0,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        rename: (from, to) => {
          calls += 1;
          if (calls <= 2) {
            const error = new Error("busy") as NodeJS.ErrnoException;
            error.code = "EBUSY";
            throw error;
          }
          renameSync(from, to);
        },
      },
    );
    assert.equal(calls, 3);
    assert.equal(sleeps.length, 2);
    assert.equal(existsSync(target), true);
    rmSync(dir, { recursive: true, force: true });
  });

  test("rename failing with a non-retryable code rethrows immediately without retrying", async () => {
    const dir = tempDir();
    const target = join(dir, "state.json");
    let calls = 0;
    await assert.rejects(
      () =>
        writeJsonAtomic(
          target,
          { ok: true },
          {
            rename: () => {
              calls += 1;
              const error = new Error("no space") as NodeJS.ErrnoException;
              error.code = "ENOSPC";
              throw error;
            },
          },
        ),
      (error: NodeJS.ErrnoException) => error.code === "ENOSPC",
    );
    assert.equal(calls, 1);
    rmSync(dir, { recursive: true, force: true });
  });

  test("retry delays come from the injected backoff parameters, not a fixed poll", async () => {
    const dir = tempDir();
    const target = join(dir, "state.json");
    let calls = 0;
    const sleeps: number[] = [];
    await writeJsonAtomic(
      target,
      { ok: true },
      {
        baseMs: 10,
        capMs: 1000,
        random: () => 1,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        rename: (from, to) => {
          calls += 1;
          if (calls <= 2) {
            const error = new Error("busy") as NodeJS.ErrnoException;
            error.code = "EBUSY";
            throw error;
          }
          renameSync(from, to);
        },
      },
    );
    assert.deepEqual(sleeps, [10, 20]);
    rmSync(dir, { recursive: true, force: true });
  });

  test("removes the temp file on failure, leaving no orphan .tmp", async () => {
    const dir = tempDir();
    const target = join(dir, "state.json");
    await assert.rejects(() =>
      writeJsonAtomic(
        target,
        { ok: true },
        {
          rename: () => {
            const error = new Error("no space") as NodeJS.ErrnoException;
            error.code = "ENOSPC";
            throw error;
          },
        },
      ),
    );
    const leftovers = readdirSync(dir).filter((name) => name.endsWith(".tmp"));
    assert.deepEqual(leftovers, []);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("updateJsonAtomic", () => {
  test("passes null to the mutator when the file does not yet exist", async () => {
    const dir = tempDir();
    const target = join(dir, "state.json");
    let seen: unknown = "not-called";
    await updateJsonAtomic(
      target,
      (current) => {
        seen = current;
        return { count: 1 };
      },
      { lockPath: join(dir, "state.lock") },
    );
    assert.equal(seen, null);
    rmSync(dir, { recursive: true, force: true });
  });

  test("applies the mutator to freshly read state across sequential calls", async () => {
    const dir = tempDir();
    const target = join(dir, "state.json");
    const lockPath = join(dir, "state.lock");
    await updateJsonAtomic<{ count: number }>(target, (current) => ({ count: (current?.count ?? 0) + 1 }), {
      lockPath,
    });
    await updateJsonAtomic<{ count: number }>(target, (current) => ({ count: (current?.count ?? 0) + 1 }), {
      lockPath,
    });
    assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { count: 2 });
    rmSync(dir, { recursive: true, force: true });
  });

  test("serializes concurrent calls under the same lockPath so no update is lost", async () => {
    const dir = tempDir();
    const target = join(dir, "state.json");
    const lockPath = join(dir, "state.lock");

    const increment = () =>
      updateJsonAtomic<{ count: number }>(target, (current) => ({ count: (current?.count ?? 0) + 1 }), {
        lockPath,
      });

    await Promise.all([increment(), increment(), increment(), increment(), increment()]);

    assert.deepEqual(JSON.parse(readFileSync(target, "utf8")), { count: 5 });
    rmSync(dir, { recursive: true, force: true });
  });
});
