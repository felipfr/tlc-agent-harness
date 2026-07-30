import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { claudeLessonsSourcePath, claudeMdPath, renderClaudeLessonsView } from "../claude.lessons-view.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-claude-lessons-view-"));
}

test("claudeLessonsSourcePath points at the shared .tlc/harness/lessons.md source of truth", () => {
  const root = tempRoot();
  try {
    assert.equal(claudeLessonsSourcePath(root), join(root, ".tlc", "harness", "lessons.md"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("claudeMdPath points at CLAUDE.md in the project root", () => {
  const root = tempRoot();
  try {
    assert.equal(claudeMdPath(root), join(root, "CLAUDE.md"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderClaudeLessonsView returns null when the SoT has not been rendered yet", () => {
  const root = tempRoot();
  try {
    assert.equal(renderClaudeLessonsView(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderClaudeLessonsView creates CLAUDE.md with just the import line when none exists", () => {
  const root = tempRoot();
  try {
    const sourcePath = claudeLessonsSourcePath(root);
    mkdirSync(dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, "# Harness lessons\n\n- fix the flaky test\n", "utf8");

    const path = renderClaudeLessonsView(root);
    assert.equal(path, claudeMdPath(root));
    assert.equal(readFileSync(path as string, "utf8"), "@.tlc/harness/lessons.md\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderClaudeLessonsView appends the import line to an existing CLAUDE.md, preserving its content", () => {
  const root = tempRoot();
  try {
    const sourcePath = claudeLessonsSourcePath(root);
    mkdirSync(dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, "# lessons\n", "utf8");
    writeFileSync(claudeMdPath(root), "# Project instructions\n\nSome existing guidance.\n", "utf8");

    const path = renderClaudeLessonsView(root) as string;
    const content = readFileSync(path, "utf8");
    assert.ok(content.startsWith("# Project instructions\n\nSome existing guidance.\n"));
    assert.ok(content.trimEnd().endsWith("@.tlc/harness/lessons.md"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderClaudeLessonsView is idempotent — re-running does not duplicate the import line", () => {
  const root = tempRoot();
  try {
    const sourcePath = claudeLessonsSourcePath(root);
    mkdirSync(dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, "# lessons\n", "utf8");
    writeFileSync(claudeMdPath(root), "# Project instructions\n", "utf8");

    renderClaudeLessonsView(root);
    renderClaudeLessonsView(root);
    renderClaudeLessonsView(root);

    const content = readFileSync(claudeMdPath(root), "utf8");
    const occurrences = content.split("@.tlc/harness/lessons.md").length - 1;
    assert.equal(occurrences, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderClaudeLessonsView adds a newline separator when existing content lacks a trailing newline", () => {
  const root = tempRoot();
  try {
    const sourcePath = claudeLessonsSourcePath(root);
    mkdirSync(dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, "# lessons\n", "utf8");
    writeFileSync(claudeMdPath(root), "no trailing newline here", "utf8");

    renderClaudeLessonsView(root);
    const content = readFileSync(claudeMdPath(root), "utf8");
    assert.ok(content.startsWith("no trailing newline here\n"));
    assert.ok(content.includes("@.tlc/harness/lessons.md"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renderClaudeLessonsView leaves an already-imported CLAUDE.md byte-identical", () => {
  const root = tempRoot();
  try {
    const sourcePath = claudeLessonsSourcePath(root);
    mkdirSync(dirname(sourcePath), { recursive: true });
    writeFileSync(sourcePath, "# lessons\n", "utf8");
    const already = "# Project instructions\n\n@.tlc/harness/lessons.md\n";
    writeFileSync(claudeMdPath(root), already, "utf8");

    renderClaudeLessonsView(root);
    assert.equal(readFileSync(claudeMdPath(root), "utf8"), already);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
