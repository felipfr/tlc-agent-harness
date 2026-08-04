import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { DEFAULT_LESSONS_POLICY } from "../../policy/policy.defaults.ts";
import { gardenLessons, promotionCount } from "../lesson.garden.ts";
import { appliesHere, isInjectable, selectLessons } from "../lesson.select.ts";
import {
  readGlobalLessons,
  readProjectLessons,
  upsertGlobalLesson,
  upsertProjectLesson,
} from "../lesson.store.ts";
import type { HarnessLesson } from "../lesson.types.ts";

const NOW = new Date("2026-08-04T12:00:00.000Z");
const CONFIG = { ...DEFAULT_LESSONS_POLICY, enabled: true, promoteHitCount: 2 };
const cleanup: string[] = [];
const originalHome = process.env.TLC_HOME;

function newDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

function projectWithGate(): string {
  const root = newDir("tlc-stale-project-");
  mkdirSync(join(root, "tools"), { recursive: true });
  writeFileSync(join(root, "tools", "gate.ts"), "export function runGate(): void {}\n", "utf8");
  return root;
}

function withRuntimeHome(): void {
  process.env.TLC_HOME = newDir("tlc-stale-home-");
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
    instruction: "run the gate itself",
    avoid: "",
    prefer: "",
    preRetryCheck: "",
    source: "project",
    tier: "project",
    status: "active",
    confidence: 0.9,
    hitCount: 3,
    priority: 50,
    refs: [],
    sessionKeys: ["s-1", "s-2"],
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

test("garden marks a project lesson stale when its ref stops resolving", async () => {
  withRuntimeHome();
  const root = projectWithGate();
  await upsertProjectLesson(root, lesson({ refs: [{ path: "tools/gate.ts", symbol: "runGate" }] }));
  unlinkSync(join(root, "tools", "gate.ts"));
  const report = await gardenLessons(root, CONFIG, NOW);
  assert.deepEqual(report.stale, ["project:test:abc"]);
  const stored = readProjectLessons(root)[0];
  assert.equal(stored?.staleReason, "path-missing");
  assert.ok(stored?.staleCheckedAt);
});

test("garden clears staleness when every ref resolves again", async () => {
  withRuntimeHome();
  const root = projectWithGate();
  await upsertProjectLesson(root, lesson({ refs: [{ path: "tools/gate.ts" }], staleReason: "path-missing" }));
  const report = await gardenLessons(root, CONFIG, NOW);
  assert.deepEqual(report.refreshed, ["project:test:abc"]);
  assert.equal(readProjectLessons(root)[0]?.staleReason, undefined);
});

test("a lesson with no refs is never marked stale", async () => {
  withRuntimeHome();
  const root = projectWithGate();
  await upsertProjectLesson(root, lesson());
  const report = await gardenLessons(root, CONFIG, NOW);
  assert.deepEqual(report.stale, []);
  assert.equal(readProjectLessons(root)[0]?.staleReason, undefined);
});

/**
 * hazard: the first version of this test asserted only that the stale lesson was absent, and passed for the wrong
 * reason — six core lessons outrank it and fill `maxInjectSession`, so absence proved nothing. The control is what
 * makes it discriminate: the same lesson, not stale, must be present.
 */
async function selectedIds(root: string): Promise<string[]> {
  const selected = await selectLessons({
    projectDir: root,
    config: { ...CONFIG, maxInjectSession: 50, maxCharsSession: 100_000 },
    mode: "session",
    now: NOW,
  });
  return selected.lessons.map((item) => item.id);
}

test("a stale lesson is withheld from injection while the same lesson is injected when fresh", async () => {
  withRuntimeHome();
  const root = projectWithGate();
  await upsertProjectLesson(root, lesson());
  assert.ok((await selectedIds(root)).includes("project:test:abc"), "control: a fresh lesson is injected");

  await upsertProjectLesson(root, lesson({ staleReason: "path-missing" }));
  assert.equal((await selectedIds(root)).includes("project:test:abc"), false);
});

test("an out-of-window lesson is withheld from injection while the same lesson is injected in window", async () => {
  withRuntimeHome();
  const root = projectWithGate();
  await upsertProjectLesson(root, lesson());
  assert.ok(
    (await selectedIds(root)).includes("project:test:abc"),
    "control: an in-window lesson is injected",
  );

  await upsertProjectLesson(root, lesson({ validTo: "2026-01-01T00:00:00.000Z" }));
  assert.equal((await selectedIds(root)).includes("project:test:abc"), false);
  assert.equal(isInjectable(lesson({ validTo: "2026-01-01T00:00:00.000Z" }), NOW), false);
});

test("garden prunes an expired lesson because the author already decided it", async () => {
  withRuntimeHome();
  const root = projectWithGate();
  await upsertProjectLesson(root, lesson({ validTo: "2026-01-01T00:00:00.000Z" }));
  const report = await gardenLessons(root, CONFIG, NOW);
  assert.deepEqual(report.expired, ["project:test:abc"]);
  assert.equal(readProjectLessons(root).length, 0);
});

// invariant: only the tier whose store shares this repository is graded. A global lesson is read from many
// repositories, so one persisted flag cannot be true for all of them.
test("garden never marks a global lesson stale from one repository's filesystem", async () => {
  withRuntimeHome();
  const root = projectWithGate();
  await upsertGlobalLesson(lesson({ id: "manual:global", refs: [{ path: "tools/absent.ts" }] }));
  const report = await gardenLessons(root, CONFIG, NOW);
  assert.deepEqual(report.stale, []);
  assert.equal(readGlobalLessons()[0]?.staleReason, undefined);
});

test("a global lesson whose ref misses here is withheld here, without being marked", () => {
  const root = projectWithGate();
  const carried = lesson({ id: "manual:global", tier: "global", refs: [{ path: "tools/absent.ts" }] });
  assert.equal(appliesHere(root, carried), false);
  assert.equal(isInjectable(carried, NOW), true);
});

test("a global lesson whose ref resolves here applies here", () => {
  const root = projectWithGate();
  const carried = lesson({ tier: "global", refs: [{ path: "tools/gate.ts", symbol: "runGate" }] });
  assert.equal(appliesHere(root, carried), true);
});

test("a project lesson is never withheld by the live ref check, only by the stored flag", () => {
  const root = projectWithGate();
  const local = lesson({ tier: "project", refs: [{ path: "tools/absent.ts" }] });
  assert.equal(appliesHere(root, local), true);
});

// invariant: promotion counts distinct sessions. `hitCount` counts fingerprint recurrences, which one stuck
// session can drive to any number.
test("one stuck session does not promote a candidate", async () => {
  withRuntimeHome();
  const root = projectWithGate();
  await upsertProjectLesson(
    root,
    lesson({ status: "candidate", hitCount: 9, sessionKeys: ["s-only"], confidence: 0.6 }),
  );
  const report = await gardenLessons(root, CONFIG, NOW);
  assert.deepEqual(report.promoted, []);
  assert.equal(readProjectLessons(root)[0]?.status, "candidate");
});

test("the same failure in two sessions promotes the candidate", async () => {
  withRuntimeHome();
  const root = projectWithGate();
  await upsertProjectLesson(
    root,
    lesson({ status: "candidate", hitCount: 2, sessionKeys: ["s-1", "s-2"], confidence: 0.6 }),
  );
  const report = await gardenLessons(root, CONFIG, NOW);
  assert.deepEqual(report.promoted, ["project:test:abc"]);
  assert.equal(readProjectLessons(root)[0]?.status, "active");
});

// why: a record written before `sessionKeys` existed has none, and freezing it as a candidate forever would be a
// silent regression for every store already on disk.
test("a legacy record with no session keys falls back to hitCount", () => {
  assert.equal(promotionCount(lesson({ sessionKeys: [], hitCount: 4 })), 4);
  assert.equal(promotionCount(lesson({ sessionKeys: ["a"], hitCount: 4 })), 1);
});
