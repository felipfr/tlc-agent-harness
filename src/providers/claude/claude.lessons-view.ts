import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { projectConfigPath } from "../../platform/paths.ts";

const IMPORT_LINE = "@.tlc/harness/lessons.md";

// why: mirrors core/lesson/lesson.garden.ts's lessonsMarkdownPath — providers cannot import core, so the join is duplicated.
export function claudeLessonsSourcePath(root: string): string {
  return join(dirname(projectConfigPath(root)), "lessons.md");
}

export function claudeMdPath(root: string): string {
  return join(root, "CLAUDE.md");
}

export function renderClaudeLessonsView(root: string): string | null {
  if (!existsSync(claudeLessonsSourcePath(root))) {
    return null;
  }

  const path = claudeMdPath(root);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const alreadyImported = existing.split("\n").some((line) => line.trim() === IMPORT_LINE);
  if (alreadyImported) {
    return path;
  }

  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  const content = existing.length > 0 ? `${existing}${separator}\n${IMPORT_LINE}\n` : `${IMPORT_LINE}\n`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return path;
}
