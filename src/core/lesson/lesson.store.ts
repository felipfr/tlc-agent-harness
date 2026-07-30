import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { updateJsonAtomic } from "../../platform/fs-atomic.ts";
import { projectStateDir } from "../../platform/paths.ts";
import type { HarnessLesson, LessonStoreFile } from "./lesson.types.ts";

export const CORE_LESSONS: readonly HarnessLesson[] = [
  {
    id: "core:gate:lint",
    scope: "gate-execution",
    failedGate: "lint",
    category: "verification",
    triggerTokens: ["lint", "biome", "eslint", "ruff", "format"],
    instruction:
      "A lint gate failure means changed files still violate the project lint command. Fix the reported findings without suppressions.",
    avoid: "Do not add lint suppressions, disable comments, or delete failing files to silence the gate.",
    prefer: "Apply the smallest fix that clears each finding, then let the stop hook re-check.",
    preRetryCheck:
      "Confirm the lint command targets only the intended changed files and still fails for the same codes.",
    source: "core",
    status: "active",
    confidence: 1,
    hitCount: 1,
    priority: 90,
    projectScoped: false,
    firstSeenAt: "1970-01-01T00:00:00.000Z",
    lastSeenAt: "1970-01-01T00:00:00.000Z",
    lastAccessedAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
  {
    id: "core:gate:test",
    scope: "gate-execution",
    failedGate: "test",
    category: "verification",
    triggerTokens: ["test", "vitest", "jest", "pytest", "failing"],
    instruction:
      "A test gate failure means assertions still fail. Fix the behavior or the test under the real contract — do not delete or skip tests.",
    avoid: "Do not delete failing tests, mark them skipped, or weaken assertions to force green.",
    prefer: "Reproduce the failure, fix root cause, re-run the same test target.",
    preRetryCheck: "Identify the failing test name/file from the gate output before editing.",
    source: "core",
    status: "active",
    confidence: 1,
    hitCount: 1,
    priority: 90,
    projectScoped: false,
    firstSeenAt: "1970-01-01T00:00:00.000Z",
    lastSeenAt: "1970-01-01T00:00:00.000Z",
    lastAccessedAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
  {
    id: "core:gate:comments",
    scope: "gate-execution",
    failedGate: "comments",
    category: "verification",
    triggerTokens: ["junk comment", "TODO", "FIXME", "banner"],
    instruction:
      "Junk-comment policy failed. Delete narrating comments, banners, TODO/FIXME, and commented-out code.",
    avoid: "Do not keep TODO markers or section banners 'for clarity'.",
    prefer: "Keep only comments that explain a non-obvious why (invariant, hazard, external constraint).",
    preRetryCheck: "Scan the listed file:line hits and remove each one.",
    source: "core",
    status: "active",
    confidence: 1,
    hitCount: 1,
    priority: 80,
    projectScoped: false,
    firstSeenAt: "1970-01-01T00:00:00.000Z",
    lastSeenAt: "1970-01-01T00:00:00.000Z",
    lastAccessedAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
  {
    id: "core:gate:ship",
    scope: "gate-execution",
    failedGate: "ship",
    category: "ship-evidence",
    triggerTokens: ["ship", "evidence", "90-verdict", "PASS"],
    instruction:
      "Ship claim without recent production PASS evidence. Produce real evidence before claiming done.",
    avoid: "Do not claim shipped based on unit tests alone when runtime paths changed.",
    prefer: "Run production E2E, write 90-verdict.txt PASS, cite the evidence path.",
    preRetryCheck: "Confirm evidenceDir and a recent PASS verdict exist for this change.",
    source: "core",
    status: "active",
    confidence: 1,
    hitCount: 1,
    priority: 95,
    projectScoped: false,
    firstSeenAt: "1970-01-01T00:00:00.000Z",
    lastSeenAt: "1970-01-01T00:00:00.000Z",
    lastAccessedAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
  {
    id: "core:gate:empty-diff",
    scope: "gate-execution",
    failedGate: "empty-diff",
    category: "ship-evidence",
    triggerTokens: ["empty", "diff", "no changes", "shipped"],
    instruction:
      "Done/shipped was claimed with zero file changes. Either implement the work or explain why zero-diff is correct — do not claim shipped on an empty tree.",
    avoid: "Do not restate 'done' without a real diff or an explicit zero-change justification.",
    prefer: "Make the missing change, or clearly document why no files should change.",
    preRetryCheck: "Inspect git status / changed files before the next stop.",
    source: "core",
    status: "active",
    confidence: 1,
    hitCount: 1,
    priority: 92,
    projectScoped: false,
    firstSeenAt: "1970-01-01T00:00:00.000Z",
    lastSeenAt: "1970-01-01T00:00:00.000Z",
    lastAccessedAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
  {
    id: "core:gate:stagnation",
    scope: "gate-execution",
    failedGate: "stagnation",
    category: "stagnation",
    triggerTokens: ["stagnation", "identical", "fingerprint", "same fail"],
    instruction:
      "Identical validation fingerprint repeated. Change approach — do not re-apply the same failing edit.",
    avoid: "Do not retry the exact same patch, command, or suppression.",
    prefer: "Diagnose root cause with a different path, or escalate with BLOCKED / TRIED / NEED.",
    preRetryCheck: "Diff your last edit against the gate output; ensure the next action is different.",
    source: "core",
    status: "active",
    confidence: 1,
    hitCount: 1,
    priority: 100,
    projectScoped: false,
    firstSeenAt: "1970-01-01T00:00:00.000Z",
    lastSeenAt: "1970-01-01T00:00:00.000Z",
    lastAccessedAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
  },
];

export function lessonsStorePath(root: string): string {
  return join(projectStateDir(root), "lessons.json");
}

function lessonsLockPath(root: string): string {
  return `${lessonsStorePath(root)}.lock`;
}

export function readProjectLessons(root: string): HarnessLesson[] {
  const path = lessonsStorePath(root);
  if (!existsSync(path)) {
    return [];
  }
  try {
    const file = JSON.parse(readFileSync(path, "utf8")) as LessonStoreFile;
    return Array.isArray(file.lessons) ? file.lessons : [];
  } catch {
    return [];
  }
}

export function allLessons(root: string): HarnessLesson[] {
  return [...CORE_LESSONS, ...readProjectLessons(root)];
}

async function mutateProjectLessons(
  root: string,
  mutate: (current: HarnessLesson[]) => HarnessLesson[],
): Promise<HarnessLesson[]> {
  const file = await updateJsonAtomic<LessonStoreFile>(
    lessonsStorePath(root),
    (current) => {
      const lessons = current && Array.isArray(current.lessons) ? current.lessons : [];
      return { version: 1, lessons: mutate(lessons) };
    },
    { lockPath: lessonsLockPath(root) },
  );
  return file.lessons;
}

export async function writeProjectLessons(root: string, lessons: HarnessLesson[]): Promise<void> {
  await mutateProjectLessons(root, () => lessons);
}

export async function upsertProjectLesson(root: string, lesson: HarnessLesson): Promise<HarnessLesson> {
  await mutateProjectLessons(root, (current) => {
    const index = current.findIndex((item) => item.id === lesson.id);
    if (index >= 0) {
      const next = [...current];
      next[index] = lesson;
      return next;
    }
    return [...current, lesson];
  });
  return lesson;
}

export async function touchAccessed(root: string, ids: string[], now = new Date()): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const idSet = new Set(ids);
  const iso = now.toISOString();
  await mutateProjectLessons(root, (current) =>
    current.map((lesson) =>
      idSet.has(lesson.id) ? { ...lesson, lastAccessedAt: iso, updatedAt: iso } : lesson,
    ),
  );
}

export async function gardenProjectLessons(
  root: string,
  mutate: (current: HarnessLesson[]) => HarnessLesson[],
): Promise<HarnessLesson[]> {
  return mutateProjectLessons(root, mutate);
}
