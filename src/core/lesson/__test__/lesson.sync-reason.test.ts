import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LESSONS_POLICY } from "../../policy/policy.defaults.ts";
import { emptySyncReason } from "../lesson.garden.ts";
import type { HarnessLesson } from "../lesson.types.ts";

const NOW = new Date("2026-08-05T12:00:00.000Z");
const ON = { ...DEFAULT_LESSONS_POLICY, enabled: true, promoteHitCount: 2 };

function lesson(overrides: Partial<HarnessLesson> = {}): HarnessLesson {
  return {
    id: "project:test:abc",
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
    status: "candidate",
    confidence: 0.6,
    hitCount: 1,
    priority: 70,
    pinned: false,
    refs: [],
    sessionKeys: ["s-1"],
    injectedCount: 0,
    gradeableCount: 0,
    helpedCount: 0,
    neutralCount: 0,
    firstSeenAt: NOW.toISOString(),
    lastSeenAt: NOW.toISOString(),
    lastAccessedAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

/**
 * hazard: one sentence covered four situations. An operator read the file, saw "No active project lessons yet." for
 * weeks, and reported the harness as never updating it — while it was being rewritten every session with exactly
 * that text, because lessons were switched off ([/decisions/ad-049.md](/decisions/ad-049.md)).
 */
test("a switched-off capability says so, and names how to turn it on", () => {
  const reason = emptySyncReason([], { ...DEFAULT_LESSONS_POLICY, enabled: false }, NOW);
  assert.match(reason, /switched off/);
  assert.match(reason, /intelligence\.lessons\.enabled/);
  assert.match(reason, /harness-init/);
});

test("enabled with an empty store explains what actually records a lesson", () => {
  const reason = emptySyncReason([], ON, NOW);
  assert.match(reason, /No lesson recorded yet/);
  assert.match(reason, /same\* gate failure repeats/);
  assert.doesNotMatch(reason, /switched off/);
});

test("candidates with none promoted names the threshold and the command", () => {
  const reason = emptySyncReason([lesson(), lesson({ id: "b" })], ON, NOW);
  assert.match(reason, /2 candidate lessons recorded/);
  assert.match(reason, /2 distinct sessions/);
  assert.match(reason, /tlc harness lessons list/);
});

test("one candidate reads as one, not as '1 lessons'", () => {
  assert.match(emptySyncReason([lesson()], ON, NOW), /1 candidate lesson recorded/);
});

test("an active lesson that is withheld says why the file is still empty", () => {
  const reason = emptySyncReason([lesson({ status: "active", staleReason: "path-missing" })], ON, NOW);
  assert.match(reason, /1 active lesson is withheld/);
  assert.match(reason, /stopped resolving/);
});

test("a closed window counts as withheld too", () => {
  const reason = emptySyncReason(
    [lesson({ status: "active", validTo: "2026-01-01T00:00:00.000Z" })],
    ON,
    NOW,
  );
  assert.match(reason, /withheld/);
});

// invariant: the four reasons are distinct strings, or the file cannot tell an operator which one applies.
test("no two reasons read the same", () => {
  const reasons = [
    emptySyncReason([], { ...DEFAULT_LESSONS_POLICY, enabled: false }, NOW),
    emptySyncReason([], ON, NOW),
    emptySyncReason([lesson()], ON, NOW),
    emptySyncReason([lesson({ status: "active", staleReason: "path-missing" })], ON, NOW),
  ];
  assert.equal(new Set(reasons).size, reasons.length);
});
