import assert from "node:assert/strict";
import { test } from "node:test";
import type { HarnessLesson } from "../lesson.types.ts";
import { isWithinValidity, validityReason } from "../lesson.validity.ts";

const NOW = new Date("2026-08-04T12:00:00.000Z");

function lesson(overrides: Partial<HarnessLesson> = {}): HarnessLesson {
  return {
    id: "lesson-1",
    scope: "gate-execution",
    failedGate: "test",
    category: "verification",
    triggerTokens: [],
    instruction: "pin the formatter",
    avoid: "",
    prefer: "",
    preRetryCheck: "",
    source: "manual",
    tier: "project",
    status: "active",
    confidence: 0.8,
    hitCount: 1,
    priority: 50,
    pinned: false,
    refs: [],
    sessionKeys: [],
    injectedCount: 0,
    helpedCount: 0,
    neutralCount: 0,
    firstSeenAt: NOW.toISOString(),
    lastSeenAt: NOW.toISOString(),
    lastAccessedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

test("a lesson with no bounds is always within its window", () => {
  assert.equal(isWithinValidity(lesson(), NOW), true);
  assert.equal(validityReason(lesson(), NOW), "active");
});

test("a lesson whose window has closed is out", () => {
  const expired = lesson({ validTo: "2026-08-01T00:00:00.000Z" });
  assert.equal(isWithinValidity(expired, NOW), false);
  assert.equal(validityReason(expired, NOW), "expired");
});

test("a lesson whose window has not opened is out", () => {
  const pending = lesson({ validFrom: "2026-09-01T00:00:00.000Z" });
  assert.equal(isWithinValidity(pending, NOW), false);
  assert.equal(validityReason(pending, NOW), "pending");
});

test("the upper bound is exclusive so the closing instant is already out", () => {
  assert.equal(isWithinValidity(lesson({ validTo: NOW.toISOString() }), NOW), false);
});

test("the lower bound is inclusive so the opening instant is already in", () => {
  assert.equal(isWithinValidity(lesson({ validFrom: NOW.toISOString() }), NOW), true);
});

// invariant: fail closed. A lesson whose validity cannot be evaluated is withheld rather than injected.
test("an unparseable bound withholds the lesson instead of ignoring the bound", () => {
  assert.equal(isWithinValidity(lesson({ validTo: "next tuesday" }), NOW), false);
  assert.equal(validityReason(lesson({ validTo: "next tuesday" }), NOW), "invalid");
  assert.equal(isWithinValidity(lesson({ validFrom: "soon" }), NOW), false);
});

test("an empty-string bound is absent rather than invalid", () => {
  assert.equal(isWithinValidity(lesson({ validTo: "" }), NOW), true);
  assert.equal(validityReason(lesson({ validTo: "" }), NOW), "active");
});
