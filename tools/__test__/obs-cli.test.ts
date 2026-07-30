import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import type { ObsEvent } from "../../src/core/observability/observability.types.ts";
import { projectStateDir } from "../../src/platform/paths.ts";
import { latestSessionId, limitFrom, liveJson, liveText, NO_EVENTS } from "../obs-cli.ts";

const cleanupRoots: string[] = [];

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "tlc-obs-cli-"));
  cleanupRoots.push(root);
  return root;
}

afterEach(() => {
  while (cleanupRoots.length > 0) {
    const root = cleanupRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function event(kind: ObsEvent["kind"], ts: string): ObsEvent {
  return {
    schema: "harness.observability.v1",
    provider: "claude",
    kind,
    level: "signal",
    ts,
    trace_id: "trace-1",
    span_id: "span-1",
    attrs: { note: "x" },
  };
}

describe("liveText", () => {
  test("names the empty case instead of printing a blank line", () => {
    assert.equal(liveText([]), NO_EVENTS);
  });

  test("renders one tab-separated line per event", () => {
    const text = liveText([event("gate.outcome", "2026-07-30T10:00:00.000Z")]);
    assert.equal(text.split("\n").length, 1);
    assert.ok(text.startsWith("2026-07-30T10:00:00.000Z\tgate.outcome\t"));
  });
});

describe("liveJson", () => {
  test("carries a count alongside the events, and survives a JSON round trip", () => {
    const events = [
      event("gate.outcome", "2026-07-30T10:00:00.000Z"),
      event("gate.outcome", "2026-07-30T10:01:00.000Z"),
    ];
    const projected = liveJson(events);
    assert.equal(projected.count, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(projected)), projected);
  });

  test("an empty read is a count of zero, not an error", () => {
    assert.deepEqual(liveJson([]), { count: 0, events: [] });
  });
});

describe("limitFrom", () => {
  test("uses the fallback when the argument is absent or not a number", () => {
    assert.equal(limitFrom(undefined, 40), 40);
    assert.equal(limitFrom("many", 50), 50);
  });

  test("honours a numeric argument", () => {
    assert.equal(limitFrom("7", 40), 7);
  });
});

describe("latestSessionId", () => {
  test("returns null when no sessions directory exists", () => {
    assert.equal(latestSessionId(newRoot()), null);
  });

  test("returns null when the directory holds no rollups", () => {
    const root = newRoot();
    mkdirSync(join(projectStateDir(root), "sessions"), { recursive: true });
    assert.equal(latestSessionId(root), null);
  });

  test("picks the last id in sort order and strips the extension", () => {
    const root = newRoot();
    const sessions = join(projectStateDir(root), "sessions");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(join(sessions, "aaa.json"), "{}");
    writeFileSync(join(sessions, "zzz.json"), "{}");
    writeFileSync(join(sessions, "ignored.txt"), "x");
    assert.equal(latestSessionId(root), "zzz");
  });
});
