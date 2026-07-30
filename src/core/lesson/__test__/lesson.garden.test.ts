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
    projectScoped: true,
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
