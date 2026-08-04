import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_LESSONS_POLICY } from "../../policy/policy.defaults.ts";
import { gardenLessons, lessonsMarkdownPath, renderLessonsMarkdown } from "../lesson.garden.ts";
import { readProjectLessons, writeProjectLessons } from "../lesson.store.ts";
import type { HarnessLesson } from "../lesson.types.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-lesson-garden-"));
}

function lesson(overrides: Partial<HarnessLesson> & Pick<HarnessLesson, "id">): HarnessLesson {
  const now = "2026-07-27T00:00:00.000Z";
  return {
    scope: "gate-execution",
    failedGate: "test",
    category: "test",
    triggerTokens: ["test"],
    instruction: "fix it",
    avoid: "do not guess",
    prefer: "read the assertion",
    preRetryCheck: "check the failing test",
    source: "project",
    status: "candidate",
    confidence: 0.5,
    hitCount: 1,
    priority: 50,
    tier: "project",
    pinned: false,
    refs: [],
    sessionKeys: [],
    injectedCount: 0,
    helpedCount: 0,
    neutralCount: 0,
    firstSeenAt: now,
    lastSeenAt: now,
    lastAccessedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test("gardenLessons promotes a candidate once it reaches the promote-hit-count threshold", async () => {
  const root = tempRoot();
  try {
    await writeProjectLessons(root, [lesson({ id: "project:test:a", status: "candidate", hitCount: 3 })]);
    const report = await gardenLessons(root, { ...DEFAULT_LESSONS_POLICY, promoteHitCount: 2 });
    assert.deepEqual(report.promoted, ["project:test:a"]);
    const stored = readProjectLessons(root);
    assert.equal(stored[0]?.status, "active");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gardenLessons quarantines a stale active lesson that never earned enough hits", async () => {
  const root = tempRoot();
  try {
    const old = new Date(Date.now() - 24 * 100 * 60 * 60 * 1000).toISOString();
    await writeProjectLessons(root, [
      lesson({
        id: "project:test:a",
        status: "active",
        hitCount: 1,
        lastSeenAt: old,
        confidence: 0.6,
        lastAccessedAt: new Date().toISOString(),
      }),
    ]);
    const report = await gardenLessons(root, { ...DEFAULT_LESSONS_POLICY, promoteHitCount: 5 });
    assert.deepEqual(report.quarantined, ["project:test:a"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gardenLessons prunes a lesson quarantined for far too long", async () => {
  const root = tempRoot();
  try {
    const ancient = new Date(Date.now() - 24 * 200 * 60 * 60 * 1000).toISOString();
    await writeProjectLessons(root, [
      lesson({ id: "project:test:a", status: "quarantine", lastSeenAt: ancient, confidence: 0.6 }),
    ]);
    const report = await gardenLessons(root, DEFAULT_LESSONS_POLICY);
    assert.deepEqual(report.pruned, ["project:test:a"]);
    assert.equal(readProjectLessons(root).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gardenLessons never persists a core-sourced lesson into the project store", async () => {
  const root = tempRoot();
  try {
    await writeProjectLessons(root, [lesson({ id: "core:leaked", source: "core", status: "active" })]);
    await gardenLessons(root, DEFAULT_LESSONS_POLICY);
    assert.equal(readProjectLessons(root).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderLessonsMarkdown writes the single lessons.md source of truth", () => {
  const root = tempRoot();
  try {
    const a = lesson({
      id: "project:test:a",
      status: "active",
      priority: 90,
      instruction: "Fix the test gate.",
    });
    const path = renderLessonsMarkdown(root, [a], 4000);
    assert.equal(path, lessonsMarkdownPath(root));
    const content = readFileSync(path, "utf8");
    assert.ok(content.includes("Fix the test gate."));
    assert.ok(content.includes("Auto-synced"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderLessonsMarkdown notes omissions without truncating mid-sentence", () => {
  const root = tempRoot();
  try {
    const a = lesson({
      id: "project:test:a",
      priority: 90,
      status: "active",
      instruction: "Fix the test gate.",
    });
    const b = lesson({
      id: "project:test:b",
      priority: 80,
      hitCount: 5,
      status: "active",
      instruction: "Ship claims need evidence.",
    });
    const c = lesson({
      id: "project:test:c",
      priority: 10,
      status: "active",
      instruction: "Low priority noise lesson.",
    });
    const path = renderLessonsMarkdown(root, [a, b, c], 420);
    const content = readFileSync(path, "utf8");
    assert.match(content, /_\(\d+ more active lessons? omitted under char budget\)_/);
    assert.equal(content.includes("\n…\n"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// invariant: pruning measures recurrence. An injected lesson used to postpone its own pruning forever,
// because touchAccessed refreshed the very field the prune expression read.
test("gardenLessons prunes a faded candidate even when it was injected moments ago", async () => {
  const root = tempRoot();
  try {
    const longAgo = new Date(Date.now() - 24 * 30 * 60 * 60 * 1000).toISOString();
    await writeProjectLessons(root, [
      lesson({
        id: "project:test:faded",
        status: "candidate",
        hitCount: 1,
        confidence: 0.55,
        lastSeenAt: longAgo,
        lastAccessedAt: new Date().toISOString(),
      }),
    ]);

    const report = await gardenLessons(root, DEFAULT_LESSONS_POLICY);
    assert.deepEqual(report.pruned, ["project:test:faded"]);
    assert.equal(readProjectLessons(root).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gardenLessons keeps a candidate whose failure recurred recently", async () => {
  const root = tempRoot();
  try {
    await writeProjectLessons(root, [
      lesson({
        id: "project:test:live",
        status: "candidate",
        hitCount: 1,
        confidence: 0.55,
        lastSeenAt: new Date().toISOString(),
        lastAccessedAt: new Date(Date.now() - 24 * 30 * 60 * 60 * 1000).toISOString(),
      }),
    ]);
    const report = await gardenLessons(root, DEFAULT_LESSONS_POLICY);
    assert.deepEqual(report.pruned, []);
    assert.equal(readProjectLessons(root).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// why: seeded from the operator's real record (project:test:03dfc3a63df1). AD-021 made an unresolved gate
// command classify as `config`, so a `verification` lesson carrying a runner-resolution signal could only
// have been recorded before that fix and can never legitimately recur — yet it kept outranking live lessons.
const AD021_MISFILE =
  'Fix the test findings without suppressions or deleted tests; re-run until the gate passes. Recurrent failure signature on gate "test". Signal: error: justfile does not contain recipe `bots/platform-agent/src/agent/investigator.test.ts`';

test("gardenLessons retires a verification lesson whose signal is an unresolved gate command", async () => {
  const root = tempRoot();
  try {
    await writeProjectLessons(root, [
      lesson({
        id: "project:test:03dfc3a63df1",
        category: "verification",
        status: "candidate",
        confidence: 0.55,
        hitCount: 1,
        instruction: AD021_MISFILE,
        lastSeenAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString(),
      }),
    ]);

    const report = await gardenLessons(root, DEFAULT_LESSONS_POLICY);
    assert.deepEqual(report.pruned, ["project:test:03dfc3a63df1"]);
    assert.equal(readProjectLessons(root).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gardenLessons keeps the same signal when it is correctly classified as config", async () => {
  const root = tempRoot();
  try {
    await writeProjectLessons(root, [
      // why: a fresh lastSeenAt, so this asserts the misfile rule alone and is not decided by decay —
      // the helper's fixed fixture date is old enough that pruning would pass for the wrong reason.
      lesson({
        id: "project:test:cfg",
        category: "config",
        instruction: AD021_MISFILE,
        lastSeenAt: new Date().toISOString(),
      }),
    ]);
    const report = await gardenLessons(root, DEFAULT_LESSONS_POLICY);
    assert.deepEqual(report.pruned, []);
    assert.equal(readProjectLessons(root).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gardenLessons keeps a verification lesson about an ordinary assertion failure", async () => {
  const root = tempRoot();
  try {
    await writeProjectLessons(root, [
      lesson({
        id: "project:test:real",
        category: "verification",
        instruction:
          'Recurrent failure signature on gate "test". Signal: not ok 1 - emits the metric | AssertionError: values differ',
        lastSeenAt: new Date().toISOString(),
      }),
    ]);
    const report = await gardenLessons(root, DEFAULT_LESSONS_POLICY);
    assert.deepEqual(report.pruned, []);
    assert.equal(readProjectLessons(root).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
