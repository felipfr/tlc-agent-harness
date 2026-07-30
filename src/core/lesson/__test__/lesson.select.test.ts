import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_LESSONS_POLICY } from "../../policy/policy.defaults.ts";
import {
  omitLessonsNote,
  packLessonsUnderBudget,
  rankLessonsForSync,
  renderLessonBlock,
  selectLessons,
} from "../lesson.select.ts";
import { writeProjectLessons } from "../lesson.store.ts";
import type { HarnessLesson } from "../lesson.types.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-lesson-select-"));
}

function lesson(partial: Partial<HarnessLesson> & Pick<HarnessLesson, "id" | "instruction">): HarnessLesson {
  const now = "2026-07-27T00:00:00.000Z";
  return {
    scope: "gate-execution",
    failedGate: "test",
    category: "test",
    triggerTokens: ["test"],
    avoid: "Do not guess the failure.",
    prefer: "Read the failing assertion first.",
    preRetryCheck: "Identify the failing test name/file from the output.",
    source: "project",
    status: "active",
    confidence: 0.8,
    hitCount: 2,
    priority: 50,
    projectScoped: true,
    firstSeenAt: now,
    lastSeenAt: now,
    lastAccessedAt: now,
    updatedAt: now,
    ...partial,
  };
}

test("rankLessonsForSync orders active lessons by priority then hit count", () => {
  const a = lesson({ id: "a", priority: 90, instruction: "a" });
  const b = lesson({ id: "b", priority: 80, hitCount: 5, instruction: "b" });
  const c = lesson({ id: "c", priority: 10, instruction: "c" });
  const ranked = rankLessonsForSync([c, a, b]);
  assert.deepEqual(
    ranked.map((l) => l.id),
    ["a", "b", "c"],
  );
});

test("packLessonsUnderBudget includes at least one lesson and notes the rest as omitted", () => {
  const a = lesson({ id: "a", priority: 90, instruction: "Fix the test gate before claiming done." });
  const b = lesson({ id: "b", priority: 80, hitCount: 5, instruction: "Ship claims need evidence." });
  const c = lesson({ id: "c", priority: 10, instruction: "Low priority noise lesson." });
  const title = "Learned harness lessons (auto-synced; do not hand-edit):";
  const packed = packLessonsUnderBudget({ lessons: rankLessonsForSync([c, a, b]), maxChars: 420, title });

  assert.ok(packed.included.length >= 1);
  assert.ok(packed.omitted >= 1);
  assert.ok(packed.body.includes(omitLessonsNote(packed.omitted)));
  for (const included of packed.included) {
    assert.ok(packed.body.includes(renderLessonBlock(included)));
  }
});

test("packLessonsUnderBudget never truncates a block mid-sentence with an ellipsis", () => {
  const a = lesson({
    id: "a",
    instruction: "Make the missing change, or clearly document why no files should change.",
  });
  const single = packLessonsUnderBudget({ lessons: [a], maxChars: 40, title: "Title" });
  assert.equal(single.included.length, 1);
  assert.ok(single.body.includes(renderLessonBlock(a)));
  assert.equal(single.body.includes("\n…"), false);
});

test("omitLessonsNote pluralizes correctly", () => {
  assert.equal(omitLessonsNote(0), "");
  assert.match(omitLessonsNote(1), /1 more active lesson omitted/);
  assert.match(omitLessonsNote(3), /3 more active lessons omitted/);
});

test("selectLessons returns nothing when lessons are disabled", async () => {
  const root = tempRoot();
  try {
    const result = await selectLessons({
      projectDir: root,
      config: { ...DEFAULT_LESSONS_POLICY, enabled: false },
      mode: "session",
    });
    assert.deepEqual(result, { lessons: [], usedIds: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("selectLessons ranks a project lesson matching the gate above the built-in seed lessons", async () => {
  const root = tempRoot();
  try {
    await writeProjectLessons(root, [
      lesson({ id: "project:test:x", failedGate: "test", priority: 60, instruction: "project-specific fix" }),
    ]);
    const result = await selectLessons({
      projectDir: root,
      config: { ...DEFAULT_LESSONS_POLICY, enabled: true },
      mode: "retry",
      gate: "test",
    });
    assert.ok(result.lessons.some((l) => l.id === "project:test:x"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("selectLessons records touched ids as lastAccessedAt updates for project lessons only", async () => {
  const root = tempRoot();
  try {
    await writeProjectLessons(root, [
      lesson({ id: "project:test:x", failedGate: "test", instruction: "project-specific fix" }),
    ]);
    const result = await selectLessons({
      projectDir: root,
      config: { ...DEFAULT_LESSONS_POLICY, enabled: true },
      mode: "retry",
      gate: "test",
    });
    assert.ok(result.usedIds.includes("project:test:x"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
