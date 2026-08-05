import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  allLessons,
  CORE_LESSONS,
  readProjectLessons,
  touchAccessed,
  upsertProjectLesson,
} from "../lesson.store.ts";
import type { HarnessLesson } from "../lesson.types.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-lesson-store-"));
}

function lesson(id: string): HarnessLesson {
  const now = "2026-07-27T00:00:00.000Z";
  return {
    id,
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
  };
}

test("readProjectLessons returns an empty array when no store exists", () => {
  const root = tempRoot();
  try {
    assert.deepEqual(readProjectLessons(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("allLessons merges the core seed with the project store", async () => {
  const root = tempRoot();
  try {
    await upsertProjectLesson(root, lesson("project:test:x"));
    const all = allLessons(root);
    assert.equal(all.length, CORE_LESSONS.length + 1);
    assert.ok(all.some((l) => l.id === "project:test:x"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("upsertProjectLesson adds a new lesson and later updates it in place", async () => {
  const root = tempRoot();
  try {
    await upsertProjectLesson(root, lesson("project:test:x"));
    const updated = { ...lesson("project:test:x"), confidence: 0.9 };
    await upsertProjectLesson(root, updated);
    const stored = readProjectLessons(root);
    assert.equal(stored.length, 1);
    assert.equal(stored[0]?.confidence, 0.9);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("touchAccessed updates lastAccessedAt only for the given ids", async () => {
  const root = tempRoot();
  try {
    await upsertProjectLesson(root, lesson("project:test:a"));
    await upsertProjectLesson(root, lesson("project:test:b"));
    await touchAccessed(root, ["project:test:a"], new Date("2030-01-01T00:00:00.000Z"));
    const stored = readProjectLessons(root);
    const a = stored.find((l) => l.id === "project:test:a");
    const b = stored.find((l) => l.id === "project:test:b");
    assert.equal(a?.lastAccessedAt, "2030-01-01T00:00:00.000Z");
    assert.notEqual(b?.lastAccessedAt, "2030-01-01T00:00:00.000Z");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("touchAccessed with an empty id list is a no-op", async () => {
  const root = tempRoot();
  try {
    await upsertProjectLesson(root, lesson("project:test:a"));
    await touchAccessed(root, []);
    assert.equal(readProjectLessons(root).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readProjectLessons tolerates a malformed store file", async () => {
  const root = tempRoot();
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const { projectStateDir } = await import("../../../platform/paths.ts");
  try {
    mkdirSync(projectStateDir(root), { recursive: true });
    writeFileSync(join(projectStateDir(root), "lessons.json"), "{not json");
    assert.deepEqual(readProjectLessons(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
