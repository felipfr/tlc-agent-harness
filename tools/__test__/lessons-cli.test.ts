import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import type { HarnessLesson } from "../../src/core/lesson/lesson.types.ts";
import { DEFAULTS } from "../../src/core/policy/policy.defaults.ts";
import { lessonRows, listReport, listText } from "../lessons-cli.ts";

const cleanupRoots: string[] = [];

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "tlc-lessons-cli-"));
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

const CONFIG = DEFAULTS.intelligence.lessons;
const NOW = new Date("2026-07-30T12:00:00.000Z");

function lesson(overrides: Partial<HarnessLesson> = {}): HarnessLesson {
  return {
    id: "lesson-1",
    scope: "gate-execution",
    failedGate: "lint",
    category: "verification",
    triggerTokens: ["lint", "biome"],
    instruction: "Do not retry the same failing patch.",
    avoid: "Re-applying the same edit.",
    prefer: "Diagnose the root cause on a different path.",
    preRetryCheck: "Diff the last edit against the gate output.",
    source: "project",
    status: "active",
    confidence: 0.8,
    hitCount: 2,
    priority: 1,
    projectScoped: true,
    firstSeenAt: NOW.toISOString(),
    lastSeenAt: NOW.toISOString(),
    lastAccessedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

describe("lessonRows", () => {
  test("projects the fields the text renderer prints, plus a computed score", () => {
    const rows = lessonRows([lesson()], CONFIG, NOW);
    assert.equal(rows.length, 1);
    const row = rows[0];
    assert.equal(row?.id, "lesson-1");
    assert.equal(row?.gate, "lint");
    assert.equal(row?.hits, 2);
    assert.equal(row?.source, "project");
    assert.equal(typeof row?.score, "number");
  });

  test("an empty store projects to an empty list, not to a placeholder row", () => {
    assert.deepEqual(lessonRows([], CONFIG, NOW), []);
  });
});

describe("listReport", () => {
  test("carries the count, the store path and the three config facts", () => {
    const root = newRoot();
    const report = listReport(root, [lesson(), lesson({ id: "lesson-2" })], CONFIG, NOW);
    assert.equal(report.count, 2);
    assert.ok(report.storePath.startsWith(root));
    assert.deepEqual(report.config, {
      enabled: CONFIG.enabled,
      promoteHitCount: CONFIG.promoteHitCount,
      syncRulesFile: CONFIG.syncRulesFile,
    });
  });

  test("survives a JSON round trip", () => {
    const report = listReport(newRoot(), [lesson()], CONFIG, NOW);
    assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  });
});

describe("listText", () => {
  // invariant: the human view is rendered from the same projection the flag emits, so the two can never
  // report different counts or a different store path.
  test("renders from the report, naming the count and the store path", () => {
    const root = newRoot();
    const report = listReport(root, [lesson()], CONFIG, NOW);
    const text = listText(report);
    assert.match(text, /1 lesson\(s\)/);
    assert.ok(text.includes(report.storePath));
    assert.match(text, /gate=lint hits=2 src=project/);
  });

  test("an empty store still reports the count and the config line", () => {
    const text = listText(listReport(newRoot(), [], CONFIG, NOW));
    assert.match(text, /0 lesson\(s\)/);
    assert.match(text, /promoteHitCount=/);
  });
});
