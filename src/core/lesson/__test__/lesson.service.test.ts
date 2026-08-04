import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { suggestionFor } from "../../turn/turn.failure-signals.ts";
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
      sessionKey: "s-1",
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
      sessionKey: "s-1",
    });
    const second = await recordLessonFromFailure({
      projectDir: root,
      gate: "lint",
      category: "verification",
      fingerprint: "fp-1",
      output: "biome: 1 error",
      sessionKey: "s-1",
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
      sessionKey: "s-1",
    });
    await recordLessonFromFailure({
      projectDir: root,
      gate: "lint",
      category: "verification",
      fingerprint: "fp-2",
      output: "biome: another error",
      sessionKey: "s-1",
    });
    assert.equal(readProjectLessons(root).length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// invariant: a lesson must add something the gate did not already say. stop.ts prints next_action from
// suggestionFor(category, gate) and used to hand the same string here to be prefixed onto the instruction,
// so the top-ranked lesson opened by repeating the line directly above it.
test("a recorded lesson does not restate the gate suggestion", async () => {
  const root = tempRoot();
  try {
    const lesson = await recordLessonFromFailure({
      projectDir: root,
      gate: "test",
      category: "verification",
      fingerprint: "abc123",
      output: "not ok 1 - emits the metric\nAssertionError: values differ",
      sessionKey: "s-1",
    });

    assert.doesNotMatch(lesson.instruction, /without suppressions or deleted tests/);
    assert.ok(!lesson.instruction.includes(suggestionFor("verification", "test")));
    // ...while still carrying what only the lesson knows.
    assert.match(lesson.instruction, /gate "test"/);
    assert.match(lesson.instruction, /Signal:/);
    assert.match(lesson.instruction, /emits the metric/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a lesson with no usable snippet still has a meaningful instruction", async () => {
  const root = tempRoot();
  try {
    const lesson = await recordLessonFromFailure({
      projectDir: root,
      gate: "lint",
      category: "verification",
      fingerprint: "def456",
      output: "",
      sessionKey: "s-1",
    });

    assert.ok(lesson.instruction.trim().length > 0);
    assert.match(lesson.instruction, /gate "lint"/);
    assert.doesNotMatch(lesson.instruction, /Signal:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
