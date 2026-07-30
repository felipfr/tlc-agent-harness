import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { projectConfigPath } from "../../platform/paths.ts";

// why: mirrors core/lesson/lesson.garden.ts's lessonsMarkdownPath — providers cannot import core, so the join is duplicated.
export function cursorLessonsSourcePath(root: string): string {
  return join(dirname(projectConfigPath(root)), "lessons.md");
}

export function cursorLessonsViewPath(root: string): string {
  return join(root, ".cursor", "rules", "harness-lessons.mdc");
}

export function renderCursorLessonsView(root: string): string | null {
  const sourcePath = cursorLessonsSourcePath(root);
  if (!existsSync(sourcePath)) {
    return null;
  }
  const body = readFileSync(sourcePath, "utf8");
  const path = cursorLessonsViewPath(root);
  mkdirSync(dirname(path), { recursive: true });
  const content = `---
description: Harness-learned lessons (auto-synced from gate failures)
alwaysApply: true
---

${body}`;
  writeFileSync(path, content, "utf8");
  return path;
}
