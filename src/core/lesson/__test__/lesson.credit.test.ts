import assert from "node:assert/strict";
import { test } from "node:test";
import {
  creditLesson,
  effectivenessLine,
  gradedCount,
  helpRate,
  lessonEffectiveness,
} from "../lesson.credit.ts";
import type { HarnessLesson } from "../lesson.types.ts";

const NOW = "2026-08-04T12:00:00.000Z";

function lesson(overrides: Partial<HarnessLesson> = {}): HarnessLesson {
  return {
    id: "lesson-1",
    scope: "gate-execution",
    failedGate: "test",
    category: "verification",
    triggerTokens: [],
    instruction: "read the assertion",
    avoid: "",
    prefer: "",
    preRetryCheck: "",
    source: "project",
    tier: "project",
    status: "active",
    confidence: 0.8,
    hitCount: 2,
    priority: 50,
    pinned: false,
    refs: [],
    sessionKeys: [],
    injectedCount: 0,
    helpedCount: 0,
    neutralCount: 0,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    lastAccessedAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

// invariant: a rate over zero graded injections is null, not zero. Zero would read as "measured and it never
// helped", which is a claim the harness has not earned.
test("a lesson nothing has graded has a null rate, not a zero rate", () => {
  assert.equal(helpRate(lesson({ injectedCount: 4 })), null);
  assert.equal(lessonEffectiveness(lesson({ injectedCount: 4 })), "unproven");
});

test("an injected lesson whose gate then passed reads helped", () => {
  const graded = creditLesson(lesson({ injectedCount: 1 }), "helped", NOW);
  assert.equal(graded.helpedCount, 1);
  assert.equal(graded.neutralCount, 0);
  assert.equal(lessonEffectiveness(graded), "helped");
  assert.equal(helpRate(graded), 1);
});

test("an injected lesson whose gate failed again reads neutral", () => {
  const graded = creditLesson(lesson({ injectedCount: 1 }), "neutral", NOW);
  assert.equal(graded.neutralCount, 1);
  assert.equal(lessonEffectiveness(graded), "neutral");
  assert.equal(helpRate(graded), 0);
});

test("one help among several failures still reads helped, because it has helped once", () => {
  const graded = lesson({ helpedCount: 1, neutralCount: 3 });
  assert.equal(gradedCount(graded), 4);
  assert.equal(lessonEffectiveness(graded), "helped");
  assert.equal(helpRate(graded), 0.25);
});

test("the rendered line distinguishes unproven from measured", () => {
  assert.match(effectivenessLine(lesson({ injectedCount: 3 })), /^unproven \(injected 3x, graded 0x\)$/);
  assert.equal(effectivenessLine(lesson({ helpedCount: 2, neutralCount: 1 })), "helped 2/3");
});

test("crediting stamps the update time and leaves the injection count alone", () => {
  const graded = creditLesson(
    lesson({ injectedCount: 5, updatedAt: "2026-01-01T00:00:00.000Z" }),
    "helped",
    NOW,
  );
  assert.equal(graded.updatedAt, NOW);
  assert.equal(graded.injectedCount, 5);
});
