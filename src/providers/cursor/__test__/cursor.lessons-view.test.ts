import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  cursorLessonsSourcePath,
  cursorLessonsViewPath,
  renderCursorLessonsView,
} from "../cursor.lessons-view.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-cursor-lessons-view-"));
}

test("cursorLessonsSourcePath points at the shared .tlc/harness/lessons.md source of truth", () => {
  const root = tempRoot();
  try {
    assert.equal(cursorLessonsSourcePath(root), join(root, ".tlc", "harness", "lessons.md"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cursorLessonsViewPath points at .cursor/rules/harness-lessons.mdc", () => {
  const root = tempRoot();
  try {
    assert.equal(cursorLessonsViewPath(root), join(root, ".cursor", "rules", "harness-lessons.mdc"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderCursorLessonsView returns null when the SoT has not been rendered yet", () => {
  const root = tempRoot();
  try {
    assert.equal(renderCursorLessonsView(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderCursorLessonsView wraps the SoT markdown in a Cursor-native rule file", () => {
  const root = tempRoot();
  try {
    const sourcePath = cursorLessonsSourcePath(root);
    mkdirSync(dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, "# Harness lessons\n\n- fix the flaky test\n", "utf8");

    const path = renderCursorLessonsView(root);
    assert.equal(path, cursorLessonsViewPath(root));

    const content = readFileSync(path as string, "utf8");
    assert.ok(content.startsWith("---\n"));
    assert.ok(content.includes("alwaysApply: true"));
    assert.ok(content.includes("- fix the flaky test"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderCursorLessonsView does not re-implement selection — it carries the SoT content verbatim", () => {
  const root = tempRoot();
  try {
    const sourcePath = cursorLessonsSourcePath(root);
    mkdirSync(dirname(sourcePath), { recursive: true });
    const body = "# Harness lessons\n\n- a\n- b\n- c\n";
    writeFileSync(sourcePath, body, "utf8");

    const path = renderCursorLessonsView(root) as string;
    const content = readFileSync(path, "utf8");
    assert.ok(content.endsWith(body));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
