import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { recordLessonFromFailure } from "../lesson.service.ts";
import { readProjectLessons } from "../lesson.store.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-lesson-service-"));
}

test("recordLessonFromFailure creates a new candidate lesson on first sight", async () => {
  const root = tempRoot();
  try {
    const lesson = await recordLessonFromFailure({
      projectDir: root,
      gate: "lint",
      category: "verification",
      fingerprint: "fp-1",
      output: "biome: 1 error",
      suggestion: "Fix the reported lint finding.",
    });
    assert.equal(lesson.status, "candidate");
    assert.equal(lesson.hitCount, 1);
    assert.equal(readProjectLessons(root).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a repeat of the same fingerprint increments hitCount and confidence on the same lesson", async () => {
  const root = tempRoot();
  try {
    await recordLessonFromFailure({
      projectDir: root,
      gate: "lint",
      category: "verification",
      fingerprint: "fp-1",
      output: "biome: 1 error",
      suggestion: "Fix the reported lint finding.",
    });
    const second = await recordLessonFromFailure({
      projectDir: root,
      gate: "lint",
      category: "verification",
      fingerprint: "fp-1",
      output: "biome: 1 error",
      suggestion: "Fix the reported lint finding.",
    });
    assert.equal(second.hitCount, 2);
    assert.equal(readProjectLessons(root).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a different fingerprint on the same gate produces a separate lesson", async () => {
  const root = tempRoot();
  try {
    await recordLessonFromFailure({
      projectDir: root,
      gate: "lint",
      category: "verification",
      fingerprint: "fp-1",
      output: "biome: 1 error",
      suggestion: "Fix it.",
    });
    await recordLessonFromFailure({
      projectDir: root,
      gate: "lint",
      category: "verification",
      fingerprint: "fp-2",
      output: "biome: another error",
      suggestion: "Fix it.",
    });
    assert.equal(readProjectLessons(root).length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
