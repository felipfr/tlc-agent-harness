import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";
import {
  allLessons,
  creditLessons,
  globalLessonsStorePath,
  lessonsStorePath,
  readGlobalLessons,
  readProjectLessons,
  touchAccessed,
  upsertGlobalLesson,
  upsertLesson,
  upsertProjectLesson,
} from "../lesson.store.ts";
import type { HarnessLesson } from "../lesson.types.ts";

const NOW = "2026-08-04T12:00:00.000Z";
const cleanup: string[] = [];
const originalHome = process.env.TLC_HOME;

function newDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

function withRuntimeHome(): string {
  const home = newDir("tlc-lesson-home-");
  process.env.TLC_HOME = home;
  return home;
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
    id: "lesson-1",
    scope: "gate-execution",
    failedGate: "test",
    category: "verification",
    triggerTokens: [],
    instruction: "read the assertion",
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
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    lastAccessedAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

test("the two writable stores are different files", () => {
  withRuntimeHome();
  const root = newDir("tlc-lesson-project-");
  assert.notEqual(lessonsStorePath(root), globalLessonsStorePath());
});

test("a global lesson is read in a project that has never seen it", async () => {
  withRuntimeHome();
  const root = newDir("tlc-lesson-project-");
  await upsertGlobalLesson(lesson({ id: "manual:global" }));
  assert.equal(readProjectLessons(root).length, 0);
  const ids = allLessons(root).map((item) => item.id);
  assert.ok(ids.includes("manual:global"));
});

/**
 * hazard: an earlier version wrote the lying tier through `upsertGlobalLesson`, which stamps the tier before
 * writing — so the file already said `global` and the read-time derivation was never exercised. The file is
 * written directly here for that reason.
 */
test("the tier is derived from the store, not trusted from the file", () => {
  withRuntimeHome();
  const path = globalLessonsStorePath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ version: 1, lessons: [lesson({ id: "manual:liar", tier: "project" })] }),
    "utf8",
  );
  const found = readGlobalLessons().find((item) => item.id === "manual:liar");
  assert.equal(found?.tier, "global");
});

test("a project store claiming the global tier still reads as project", () => {
  withRuntimeHome();
  const root = newDir("tlc-lesson-project-");
  const path = lessonsStorePath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ version: 1, lessons: [lesson({ id: "manual:liar2", tier: "global" })] }),
    "utf8",
  );
  assert.equal(readProjectLessons(root)[0]?.tier, "project");
});

test("core lessons are present without any store on disk", () => {
  withRuntimeHome();
  const root = newDir("tlc-lesson-project-");
  const core = allLessons(root).filter((item) => item.tier === "core");
  assert.ok(core.length >= 6);
  assert.equal(
    core.every((item) => item.source === "core"),
    true,
  );
});

// invariant: the nearer tier wins, so a project that rewrote a carried-in lesson reads its own version and the
// same lesson is never injected twice.
test("a duplicate id resolves to the project copy", async () => {
  withRuntimeHome();
  const root = newDir("tlc-lesson-project-");
  await upsertGlobalLesson(lesson({ id: "manual:dup", instruction: "the global wording" }));
  await upsertProjectLesson(root, lesson({ id: "manual:dup", instruction: "the project wording" }));
  const found = allLessons(root).filter((item) => item.id === "manual:dup");
  assert.equal(found.length, 1);
  assert.equal(found[0]?.instruction, "the project wording");
  assert.equal(found[0]?.tier, "project");
});

test("upsertLesson routes by tier", async () => {
  withRuntimeHome();
  const root = newDir("tlc-lesson-project-");
  await upsertLesson(root, lesson({ id: "manual:a" }), "global");
  await upsertLesson(root, lesson({ id: "manual:b" }), "project");
  assert.deepEqual(
    readGlobalLessons().map((item) => item.id),
    ["manual:a"],
  );
  assert.deepEqual(
    readProjectLessons(root).map((item) => item.id),
    ["manual:b"],
  );
});

test("injection is counted in whichever writable tier holds the lesson", async () => {
  withRuntimeHome();
  const root = newDir("tlc-lesson-project-");
  await upsertGlobalLesson(lesson({ id: "manual:g" }));
  await upsertProjectLesson(root, lesson({ id: "manual:p" }));
  await touchAccessed(root, ["manual:g", "manual:p"], new Date(NOW));
  assert.equal(readGlobalLessons()[0]?.injectedCount, 1);
  assert.equal(readProjectLessons(root)[0]?.injectedCount, 1);
});

test("a credit lands on a global lesson injected from a project", async () => {
  withRuntimeHome();
  const root = newDir("tlc-lesson-project-");
  await upsertGlobalLesson(lesson({ id: "manual:g" }));
  await creditLessons(root, ["manual:g"], "helped", new Date(NOW));
  assert.equal(readGlobalLessons()[0]?.helpedCount, 1);
  assert.equal(readGlobalLessons()[0]?.neutralCount, 0);
});

// hazard: core ships inside the runtime and is identical in every install. A counter on it would be a per-machine
// edit to a constant, and there is no file to write it to.
test("crediting a core id writes nothing and does not throw", async () => {
  withRuntimeHome();
  const root = newDir("tlc-lesson-project-");
  await creditLessons(root, ["core:gate:lint"], "helped", new Date(NOW));
  assert.equal(readProjectLessons(root).length, 0);
  assert.equal(readGlobalLessons().length, 0);
  const core = allLessons(root).find((item) => item.id === "core:gate:lint");
  assert.equal(core?.helpedCount, 0);
});

// hazard: a record written before these fields existed reads as `undefined`, and `undefined` in `hitCount + 1`
// or `refs.length` throws or poisons a comparator.
test("a record missing the newer fields normalizes on read instead of throwing", async () => {
  withRuntimeHome();
  const root = newDir("tlc-lesson-project-");
  const legacy = lesson({ id: "manual:legacy" }) as unknown as Record<string, unknown>;
  for (const key of ["refs", "sessionKeys", "injectedCount", "helpedCount", "neutralCount"]) {
    delete legacy[key];
  }
  await upsertProjectLesson(root, legacy as unknown as HarnessLesson);
  const read = readProjectLessons(root)[0];
  assert.deepEqual(read?.refs, []);
  assert.deepEqual(read?.sessionKeys, []);
  assert.equal(read?.injectedCount, 0);
  assert.equal(read?.helpedCount, 0);
  assert.equal(read?.neutralCount, 0);
});
