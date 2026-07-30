import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { projectStateDir } from "../../../platform/paths.ts";
import { sanitizeSegment } from "../../../platform/sanitize.ts";
import {
  appendAuditRecord,
  appendObsRecord,
  getRollup,
  loadRollup,
  pruneObs,
  readSignalEvents,
  saveRollup,
} from "../observability.store.ts";
import type { ObsEvent } from "../observability.types.ts";

function backdateRollup(root: string, sessionKey: string, updatedAt: string): void {
  const path = join(projectStateDir(root), "sessions", `${sanitizeSegment(sessionKey)}.json`);
  const data = JSON.parse(readFileSync(path, "utf8"));
  data.updated_at = updatedAt;
  writeFileSync(path, JSON.stringify(data));
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-obs-"));
}

function makeEvent(overrides: Partial<ObsEvent> = {}): ObsEvent {
  return {
    schema: "harness.observability.v1",
    provider: "provider-a",
    kind: "policy.deny",
    level: "signal",
    ts: new Date().toISOString(),
    trace_id: "trace",
    span_id: "span",
    attrs: {},
    ...overrides,
  };
}

test("appendObsRecord writes a record readSignalEvents can read back", () => {
  const root = tempRoot();
  try {
    const event = makeEvent();
    assert.equal(appendObsRecord(root, "obs.jsonl", event), true);
    const events = readSignalEvents(root, "obs.jsonl", 10);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.provider, "provider-a");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readSignalEvents returns an empty array for a missing file", () => {
  const root = tempRoot();
  try {
    assert.deepEqual(readSignalEvents(root, "obs.jsonl", 10), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("appendObsRecord degrades to false when the state dir cannot be created", () => {
  const root = tempRoot();
  try {
    mkdirSync(join(root, ".tlc", "harness"), { recursive: true });
    writeFileSync(join(root, ".tlc", "harness", "state"), "not a directory");
    assert.equal(appendObsRecord(root, "obs.jsonl", makeEvent()), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("loadRollup returns a fresh rollup for a session with no prior state", () => {
  const root = tempRoot();
  try {
    const rollup = loadRollup(root, "session-a", "provider-a");
    assert.equal(rollup.session_id, "session-a");
    assert.equal(rollup.provider, "provider-a");
    assert.equal(rollup.prompts, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("saveRollup and getRollup round-trip", () => {
  const root = tempRoot();
  try {
    const rollup = loadRollup(root, "session-a", "provider-a");
    rollup.prompts = 3;
    assert.equal(saveRollup(root, rollup), true);
    const reloaded = getRollup(root, "session-a");
    assert.equal(reloaded?.prompts, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("getRollup returns null for a session that was never saved", () => {
  const root = tempRoot();
  try {
    assert.equal(getRollup(root, "never-saved"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pruneObs deletes only rollups older than the retention window", () => {
  const root = tempRoot();
  try {
    const stale = loadRollup(root, "stale-session", "provider-a");
    saveRollup(root, stale);
    backdateRollup(root, "stale-session", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

    const fresh = loadRollup(root, "fresh-session", "provider-a");
    saveRollup(root, fresh);

    pruneObs(root, 14);

    assert.equal(getRollup(root, "stale-session"), null);
    assert.notEqual(getRollup(root, "fresh-session"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pruneObs on a project with no sessions dir is a no-op", () => {
  const root = tempRoot();
  try {
    assert.doesNotThrow(() => pruneObs(root, 14));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("appendAuditRecord writes a line readable back from audit.jsonl", () => {
  const root = tempRoot();
  try {
    assert.equal(
      appendAuditRecord(root, {
        ts: "2026-01-01T00:00:00.000Z",
        event: "shell.after",
        payload: { command: "ls" },
      }),
      true,
    );
    const lines = readFileSync(join(projectStateDir(root), "audit.jsonl"), "utf8")
      .trim()
      .split("\n");
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0] as string).payload, { command: "ls" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("appendAuditRecord degrades to false when the state dir cannot be created", () => {
  const root = tempRoot();
  try {
    mkdirSync(join(root, ".tlc", "harness"), { recursive: true });
    writeFileSync(join(root, ".tlc", "harness", "state"), "not a directory");
    assert.equal(
      appendAuditRecord(root, { ts: "2026-01-01T00:00:00.000Z", event: "tool.after", payload: {} }),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
