import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { projectStateDir, runtimeSpoolPath } from "../../../platform/paths.ts";
import {
  appendAuditRecord,
  appendObsRecord,
  appendSpoolRecord,
  pruneSpool,
  type SpoolEnvelope,
  spoolEnvelope,
} from "../observability.store.ts";
import { DEFAULT_OBS, type ObsEvent } from "../observability.types.ts";

const cleanup: string[] = [];
const originalHome = process.env.TLC_HOME;

function newDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

function withRuntimeHome(): string {
  const home = newDir("tlc-spool-home-");
  process.env.TLC_HOME = home;
  return home;
}

// why: a regular file cannot hold a state/ subdirectory, so mkdir fails with ENOTDIR. This is the
// portable way to stand in for an unwritable runtime home — a null byte in TLC_HOME is silently truncated
// by the environment and would leave a perfectly usable path.
function blockedHome(): string {
  const dir = newDir("tlc-spool-blocked-");
  const file = join(dir, "not-a-directory");
  writeFileSync(file, "");
  return file;
}

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.TLC_HOME;
  } else {
    process.env.TLC_HOME = originalHome;
  }
  while (cleanup.length > 0) {
    const dir = cleanup.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function event(ts = "2026-07-30T10:00:00.000Z"): ObsEvent {
  return {
    schema: "harness.observability.v1",
    provider: "provider-a",
    kind: "gate.outcome",
    level: "signal",
    ts,
    trace_id: "trace-1",
    span_id: "span-1",
    attrs: { gate: "lint" },
  };
}

function spoolLines(): SpoolEnvelope[] {
  const path = runtimeSpoolPath();
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as SpoolEnvelope);
}

describe("spoolEnvelope", () => {
  test("names the repository path and the project it came from", () => {
    const envelope = spoolEnvelope("/work/my-repo", "obs", { ts: "x" });
    assert.equal(envelope.repo, "/work/my-repo");
    assert.equal(envelope.project, "my-repo");
    assert.equal(envelope.stream, "obs");
    assert.deepEqual(envelope.record, { ts: "x" });
  });
});

describe("the default is off", () => {
  test("DEFAULT_OBS does not write outside the repository", () => {
    assert.equal(DEFAULT_OBS.globalSpool, false);
  });

  test("appendObsRecord writes only the project record when the spool is off", () => {
    withRuntimeHome();
    const root = newDir("tlc-spool-repo-");
    assert.equal(appendObsRecord(root, "obs.jsonl", event()), true);
    assert.ok(existsSync(join(projectStateDir(root), "obs.jsonl")));
    assert.deepEqual(spoolLines(), []);
  });
});

describe("when the spool is on", () => {
  test("an obs record lands in both places, wrapped with its origin", () => {
    withRuntimeHome();
    const root = newDir("tlc-spool-repo-");
    assert.equal(appendObsRecord(root, "obs.jsonl", event(), true), true);
    assert.ok(existsSync(join(projectStateDir(root), "obs.jsonl")));
    const lines = spoolLines();
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.stream, "obs");
    assert.equal(lines[0]?.repo, root);
  });

  test("an audit record is tagged as the audit stream, so the two can be told apart", () => {
    withRuntimeHome();
    const root = newDir("tlc-spool-repo-");
    appendAuditRecord(root, { ts: "2026-07-30T10:00:00.000Z", event: "tool.after", payload: {} }, true);
    assert.deepEqual(
      spoolLines().map((line) => line.stream),
      ["audit"],
    );
  });

  test("records from two repositories share one file and stay attributable", () => {
    withRuntimeHome();
    const first = newDir("tlc-spool-a-");
    const second = newDir("tlc-spool-b-");
    appendObsRecord(first, "obs.jsonl", event(), true);
    appendObsRecord(second, "obs.jsonl", event(), true);
    const repos = spoolLines().map((line) => line.repo);
    assert.equal(repos.length, 2);
    assert.notEqual(repos[0], repos[1]);
  });

  // hazard: the project copy is authoritative. A spool that cannot be written must not change the answer.
  test("an unwritable runtime home still reports the project write as successful", () => {
    const root = newDir("tlc-spool-repo-");
    process.env.TLC_HOME = blockedHome();
    assert.equal(appendObsRecord(root, "obs.jsonl", event(), true), true);
    assert.ok(existsSync(join(projectStateDir(root), "obs.jsonl")));
  });

  test("appendSpoolRecord reports failure without throwing when the home is unusable", () => {
    const root = newDir("tlc-spool-repo-");
    process.env.TLC_HOME = blockedHome();
    assert.equal(appendSpoolRecord(root, "obs", event()), false);
  });
});

describe("pruneSpool", () => {
  test("is a no-op when no spool exists", () => {
    withRuntimeHome();
    assert.equal(pruneSpool(14), 0);
  });

  test("drops records past the retention window and keeps the rest", () => {
    withRuntimeHome();
    const root = newDir("tlc-spool-repo-");
    const now = Date.parse("2026-07-30T10:00:00.000Z");
    appendSpoolRecord(root, "obs", event("2026-07-01T10:00:00.000Z"));
    appendSpoolRecord(root, "obs", event("2026-07-29T10:00:00.000Z"));
    assert.equal(pruneSpool(14, now), 1);
    const remaining = spoolLines();
    assert.equal(remaining.length, 1);
    assert.equal((remaining[0]?.record as ObsEvent | undefined)?.ts, "2026-07-29T10:00:00.000Z");
  });

  test("keeps a line it cannot date rather than silently discarding it", () => {
    withRuntimeHome();
    const root = newDir("tlc-spool-repo-");
    appendSpoolRecord(root, "audit", { event: "no-timestamp" });
    assert.equal(pruneSpool(14, Date.parse("2026-07-30T10:00:00.000Z")), 0);
    assert.equal(spoolLines().length, 1);
  });

  test("returns zero when nothing is old enough to drop", () => {
    withRuntimeHome();
    const root = newDir("tlc-spool-repo-");
    appendSpoolRecord(root, "obs", event("2026-07-29T10:00:00.000Z"));
    assert.equal(pruneSpool(14, Date.parse("2026-07-30T10:00:00.000Z")), 0);
  });
});
