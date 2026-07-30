import assert from "node:assert/strict";
import { test } from "node:test";
import { decayedConfidence, hoursSince, rankScore, relevanceScore } from "../lesson.score.ts";
import type { HarnessLesson } from "../lesson.types.ts";

function lesson(overrides: Partial<HarnessLesson> = {}): HarnessLesson {
  return {
    id: "project:test:abc",
    scope: "gate-execution",
    failedGate: "test",
    category: "verification",
    triggerTokens: ["test"],
    instruction: "fix it",
    avoid: "do not guess",
    prefer: "read the assertion",
    preRetryCheck: "check the failing test",
    source: "project",
    status: "active",
    confidence: 0.8,
    hitCount: 2,
    priority: 50,
    projectScoped: true,
    firstSeenAt: "2026-07-01T00:00:00.000Z",
    lastSeenAt: "2026-07-01T00:00:00.000Z",
    lastAccessedAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

test("hoursSince never returns a negative duration", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(hoursSince("2026-06-01T00:00:00.000Z", now), 0);
});

test("decayedConfidence never decays a core-sourced lesson", () => {
  const now = new Date("2027-01-01T00:00:00.000Z");
  const core = lesson({ source: "core", confidence: 1, lastAccessedAt: "2020-01-01T00:00:00.000Z" });
  assert.equal(decayedConfidence(core, 0.02, now), 1);
});

test("decayedConfidence reduces a project lesson's confidence over elapsed time", () => {
  const now = new Date("2026-07-01T02:00:00.000Z");
  const value = decayedConfidence(lesson(), 0.02, now);
  assert.ok(value < 0.8);
  assert.ok(value > 0);
});

test("relevanceScore rewards an exact gate match", () => {
  const withMatch = relevanceScore(lesson(), { gate: "test" });
  const withoutMatch = relevanceScore(lesson(), { gate: "lint" });
  assert.ok(withMatch > withoutMatch);
});

test("relevanceScore rewards a trigger token present in the free text", () => {
  const withToken = relevanceScore(lesson({ triggerTokens: ["flaky"] }), {
    text: "the suite is flaky today",
  });
  const withoutToken = relevanceScore(lesson({ triggerTokens: ["flaky"] }), { text: "nothing relevant" });
  assert.ok(withToken > withoutToken);
});

test("rankScore applies the project boost only to project-scoped lessons", () => {
  const now = new Date("2026-07-01T00:00:00.000Z");
  const projectScored = rankScore(lesson({ projectScoped: true }), {
    decayLambda: 0.02,
    projectBoost: 2,
    now,
  });
  const coreScored = rankScore(lesson({ projectScoped: false }), {
    decayLambda: 0.02,
    projectBoost: 2,
    now,
  });
  assert.ok(projectScored > coreScored);
});
