import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_LESSONS_POLICY } from "../../policy/policy.defaults.ts";
import { decayedConfidence } from "../lesson.score.ts";
import {
  omitLessonsNote,
  packLessonsUnderBudget,
  rankLessonsForSync,
  renderLessonBlock,
  selectLessons,
} from "../lesson.select.ts";
import { readProjectLessons, writeProjectLessons } from "../lesson.store.ts";
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
    tier: "project",
    pinned: false,
    refs: [],
    sessionKeys: [],
    injectedCount: 0,
    gradeableCount: 0,
    helpedCount: 0,
    neutralCount: 0,
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
    assert.deepEqual(result, { lessons: [], usedIds: [], omitted: 0 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * hazard: `maxInjectSession` defaults to 5 and `maxCharsSession` to 900, which fits about two rendered blocks. The
 * count promised five and the budget delivered two, with nothing anywhere saying so — the operator's own rule was
 * written, ranked, and never reached a turn ([/decisions/ad-043.md](/decisions/ad-043.md)).
 */
test("selectLessons reports how many eligible lessons the char budget dropped", async () => {
  const root = tempRoot();
  try {
    const result = await selectLessons({
      projectDir: root,
      config: { ...DEFAULT_LESSONS_POLICY, enabled: true, maxInjectSession: 5, maxCharsSession: 400 },
      mode: "session",
    });
    assert.ok(result.lessons.length < 5, "the budget must bind for this case to mean anything");
    assert.ok(result.omitted > 0, "eligible lessons were dropped and must be counted");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a budget that fits everything reports nothing omitted", async () => {
  const root = tempRoot();
  try {
    const result = await selectLessons({
      projectDir: root,
      config: {
        ...DEFAULT_LESSONS_POLICY,
        enabled: true,
        maxInjectSession: 50,
        maxCharsSession: 100_000,
      },
      mode: "session",
    });
    assert.equal(result.omitted, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * hazard: a rule the operator wrote deliberately competed on score with six shipped seeds and lost — priority 80
 * and confidence 0.8 against priority 100 and confidence 1 — so under a 900-char budget it was written, stored,
 * correct and never delivered ([/decisions/ad-043.md](/decisions/ad-043.md)).
 */
test("a pinned lesson is injected ahead of every scored lesson", async () => {
  const root = tempRoot();
  try {
    await writeProjectLessons(root, [
      lesson({ id: "manual:standing", instruction: "the standing rule", pinned: true, priority: 1 }),
    ]);
    const result = await selectLessons({
      projectDir: root,
      config: { ...DEFAULT_LESSONS_POLICY, enabled: true, maxInjectSession: 1, maxCharsSession: 100_000 },
      mode: "session",
    });
    assert.deepEqual(
      result.lessons.map((l) => l.id),
      ["manual:standing"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// invariant: pinning changes order, not eligibility. A pinned lesson that is stale still must not reach the turn.
test("a pinned lesson that is stale is still withheld", async () => {
  const root = tempRoot();
  try {
    await writeProjectLessons(root, [
      lesson({
        id: "manual:standing",
        instruction: "the standing rule",
        pinned: true,
        staleReason: "path-missing",
      }),
    ]);
    const result = await selectLessons({
      projectDir: root,
      config: { ...DEFAULT_LESSONS_POLICY, enabled: true, maxInjectSession: 50, maxCharsSession: 100_000 },
      mode: "session",
    });
    assert.equal(
      result.lessons.some((l) => l.id === "manual:standing"),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an authored lesson carries a priority on the same scale as every other producer", async () => {
  const { buildAuthoredLesson } = await import("../lesson.authored.ts");
  const authored = buildAuthoredLesson({ instruction: "x" });
  assert.ok(authored.priority >= 70, `authored priority ${authored.priority} is off the 70..100 scale`);
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

// invariant: injecting a lesson must not change what gets injected next. This is the regression that would
// have caught the self-fulfilling decay — selection writes lastAccessedAt, so any ranking input reading that
// field turns exposure into relevance and makes a matching lesson permanent.
test("selecting a lesson twice does not raise its own rank", async () => {
  const root = tempRoot();
  try {
    const stale = new Date(Date.now() - 24 * 20 * 60 * 60 * 1000).toISOString();
    await writeProjectLessons(root, [
      lesson({
        id: "project:test:x",
        instruction: "project-specific fix",
        failedGate: "test",
        lastSeenAt: stale,
        lastAccessedAt: stale,
      }),
    ]);
    const config = { ...DEFAULT_LESSONS_POLICY, enabled: true };

    const first = await selectLessons({ projectDir: root, config, mode: "retry", gate: "test" });
    const afterFirst = readProjectLessons(root).find((l) => l.id === "project:test:x");
    const second = await selectLessons({ projectDir: root, config, mode: "retry", gate: "test" });
    const afterSecond = readProjectLessons(root).find((l) => l.id === "project:test:x");

    // the injection is recorded as telemetry...
    assert.notEqual(afterFirst?.lastAccessedAt, stale);
    // ...but the field that decides relevance never moved, so the decayed value is identical.
    assert.equal(afterFirst?.lastSeenAt, stale);
    assert.equal(afterSecond?.lastSeenAt, stale);

    const now = new Date();
    assert.equal(
      decayedConfidence(afterSecond as HarnessLesson, config.decayLambda, now),
      decayedConfidence(afterFirst as HarnessLesson, config.decayLambda, now),
    );
    assert.deepEqual(
      second.lessons.map((l) => l.id),
      first.lessons.map((l) => l.id),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
