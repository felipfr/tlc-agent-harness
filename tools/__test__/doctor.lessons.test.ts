import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import type { HarnessLesson } from "../../src/core/index.ts";
import { upsertGlobalLesson, upsertProjectLesson } from "../../src/core/lesson/lesson.store.ts";
import { checkLessonHealth, plural } from "../doctor.ts";

const NOW = "2026-08-04T12:00:00.000Z";
const cleanup: string[] = [];
const originalHome = process.env.TLC_HOME;

function newDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

function projectWithLessonsOn(): string {
  const root = newDir("tlc-doctor-lessons-");
  mkdirSync(join(root, ".tlc", "harness"), { recursive: true });
  writeFileSync(
    join(root, ".tlc", "harness", "config.json"),
    JSON.stringify({ version: 1, intelligence: { lessons: { enabled: true } } }),
    "utf8",
  );
  return root;
}

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.TLC_HOME;
  } else {
    process.env.TLC_HOME = originalHome;
  }
  for (const dir of cleanup.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
    status: "active",
    confidence: 0.9,
    hitCount: 2,
    priority: 50,
    refs: [],
    sessionKeys: ["s-1", "s-2"],
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

test("a person's plural, so no operator reads '1 lesson(s)'", () => {
  assert.equal(plural(1, "lesson"), "1 lesson");
  assert.equal(plural(0, "lesson"), "0 lessons");
  assert.equal(plural(2, "lesson"), "2 lessons");
});

// why: silent when the capability is off. A row about a disabled feature is noise on every healthy run.
test("nothing is reported when lessons are disabled", () => {
  process.env.TLC_HOME = newDir("tlc-doctor-home-");
  assert.deepEqual(checkLessonHealth(newDir("tlc-doctor-off-")), []);
});

test("nothing is reported when the writable tiers are empty", () => {
  process.env.TLC_HOME = newDir("tlc-doctor-home-");
  assert.deepEqual(checkLessonHealth(projectWithLessonsOn()), []);
});

test("a healthy store reports one ok row naming the count", async () => {
  process.env.TLC_HOME = newDir("tlc-doctor-home-");
  const root = projectWithLessonsOn();
  await upsertProjectLesson(root, lesson());
  const checks = checkLessonHealth(root);
  assert.equal(checks.length, 1);
  assert.equal(checks[0]?.level, "ok");
  assert.match(checks[0]?.detail ?? "", /1 lesson across the writable tiers/);
});

test("a stale lesson is a warning that names it and the command to see it", async () => {
  process.env.TLC_HOME = newDir("tlc-doctor-home-");
  const root = projectWithLessonsOn();
  await upsertProjectLesson(root, lesson({ staleReason: "path-missing" }));
  const checks = checkLessonHealth(root);
  const stale = checks.find((check) => check.name === "stale lessons");
  assert.equal(stale?.level, "warn");
  assert.match(stale?.detail ?? "", /project:test:abc/);
  assert.match(stale?.detail ?? "", /tlc harness lessons list/);
});

test("an expired lesson is a warning pointing at garden", async () => {
  process.env.TLC_HOME = newDir("tlc-doctor-home-");
  const root = projectWithLessonsOn();
  await upsertProjectLesson(root, lesson({ validTo: "2026-01-01T00:00:00.000Z" }));
  const checks = checkLessonHealth(root);
  const window = checks.find((check) => check.name === "lessons out of window");
  assert.equal(window?.level, "warn");
  assert.match(window?.detail ?? "", /tlc harness lessons garden/);
});

// invariant: unproven is a warning, not an ok row. A lesson nothing has tested is spending injected context on an
// unjustified claim.
test("a lesson injected and never graded is a warning, not a healthy row", async () => {
  process.env.TLC_HOME = newDir("tlc-doctor-home-");
  const root = projectWithLessonsOn();
  await upsertProjectLesson(root, lesson({ injectedCount: 3 }));
  const checks = checkLessonHealth(root);
  assert.equal(
    checks.some((check) => check.level === "ok"),
    false,
  );
  const unproven = checks.find((check) => check.name === "unproven lessons");
  assert.equal(unproven?.level, "warn");
  assert.match(unproven?.detail ?? "", /never graded/);
});

// why: a lesson that has never been injected cannot be unproven — there is nothing to have measured yet.
test("a lesson that was never injected is not reported as unproven", async () => {
  process.env.TLC_HOME = newDir("tlc-doctor-home-");
  const root = projectWithLessonsOn();
  await upsertProjectLesson(root, lesson({ injectedCount: 0 }));
  assert.equal(
    checkLessonHealth(root).some((check) => check.name === "unproven lessons"),
    false,
  );
});

test("a graded lesson is not reported as unproven", async () => {
  process.env.TLC_HOME = newDir("tlc-doctor-home-");
  const root = projectWithLessonsOn();
  await upsertProjectLesson(root, lesson({ injectedCount: 3, helpedCount: 1, neutralCount: 2 }));
  const checks = checkLessonHealth(root);
  assert.equal(checks.length, 1);
  assert.equal(checks[0]?.level, "ok");
});

test("the global tier is counted alongside the project tier", async () => {
  process.env.TLC_HOME = newDir("tlc-doctor-home-");
  const root = projectWithLessonsOn();
  await upsertGlobalLesson(lesson({ id: "manual:global" }));
  const checks = checkLessonHealth(root);
  assert.match(checks[0]?.detail ?? "", /1 lesson across the writable tiers/);
});
