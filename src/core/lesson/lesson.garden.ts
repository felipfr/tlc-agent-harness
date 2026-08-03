import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { projectConfigPath } from "../../platform/paths.ts";
import { isCommandResolutionFailure } from "../gate/gate.command.ts";
import type { LessonsPolicyConfig } from "../policy/policy.types.ts";
import { hoursSince } from "./lesson.score.ts";
import { packLessonsUnderBudget, rankLessonsForSync } from "./lesson.select.ts";
import { gardenProjectLessons, readProjectLessons } from "./lesson.store.ts";
import type { HarnessLesson } from "./lesson.types.ts";

export type GardenReport = {
  promoted: string[];
  quarantined: string[];
  pruned: string[];
  active: number;
  candidates: number;
};

/**
 * A lesson recorded before AD-021, when a gate command that never resolved was classified `verification`
 * instead of `config`. Such a lesson teaches an agent to go fix tests in response to a malformed command,
 * and post-AD-021 the same output classifies `config`, so the signature cannot legitimately recur.
 *
 * hazard: exitCode 0 is passed deliberately. `isCommandResolutionFailure` returns true for 127, and stored
 * instruction text can contain any number — only the message patterns may decide this.
 */
function isStaleResolutionMisfile(lesson: HarnessLesson): boolean {
  return (
    lesson.category === "verification" &&
    isCommandResolutionFailure({ exitCode: 0, output: lesson.instruction })
  );
}

export async function gardenLessons(
  root: string,
  config: LessonsPolicyConfig,
  now = new Date(),
): Promise<GardenReport> {
  const promoted: string[] = [];
  const quarantined: string[] = [];
  const pruned: string[] = [];

  const kept = await gardenProjectLessons(root, (current) => {
    const next: HarnessLesson[] = [];
    for (const lesson of current) {
      if (lesson.source === "core") {
        continue;
      }

      if (isStaleResolutionMisfile(lesson)) {
        pruned.push(lesson.id);
        continue;
      }

      let candidate = lesson;

      if (candidate.status === "candidate" && candidate.hitCount >= config.promoteHitCount) {
        candidate = {
          ...candidate,
          status: "active",
          confidence: Math.max(candidate.confidence, 0.7),
          updatedAt: now.toISOString(),
        };
        promoted.push(candidate.id);
      }

      const idleHours = hoursSince(candidate.lastSeenAt, now);
      if (
        candidate.status === "active" &&
        idleHours > 24 * 90 &&
        candidate.hitCount < config.promoteHitCount
      ) {
        candidate = { ...candidate, status: "quarantine", updatedAt: now.toISOString() };
        quarantined.push(candidate.id);
      }

      if (candidate.status === "quarantine" && idleHours > 24 * 180) {
        pruned.push(candidate.id);
        continue;
      }

      // invariant: pruning measures the same clock the ranking does — recurrence, not injection. Reading
      // lastAccessedAt here let an injected lesson postpone its own pruning indefinitely.
      const decayed =
        candidate.confidence * Math.exp(-config.decayLambda * hoursSince(candidate.lastSeenAt, now));
      if (decayed < 0.05 && candidate.status !== "quarantine" && candidate.hitCount < 2) {
        pruned.push(candidate.id);
        continue;
      }

      next.push(candidate);
    }
    return next;
  });

  return {
    promoted,
    quarantined,
    pruned,
    active: kept.filter((l) => l.status === "active").length,
    candidates: kept.filter((l) => l.status === "candidate").length,
  };
}

const SYNC_TITLE = "Learned harness lessons (auto-synced; do not hand-edit):";

export function lessonsMarkdownPath(root: string): string {
  return join(dirname(projectConfigPath(root)), "lessons.md");
}

export function renderLessonsMarkdown(root: string, lessons: HarnessLesson[], maxChars: number): string {
  const ranked = rankLessonsForSync(lessons).slice(0, 12);
  const { body } = packLessonsUnderBudget({ lessons: ranked, maxChars, title: SYNC_TITLE });
  const path = lessonsMarkdownPath(root);
  mkdirSync(dirname(path), { recursive: true });
  const content = `# Harness lessons

Auto-synced from gate failures; do not hand-edit.

${body || "No active project lessons yet."}
`;
  writeFileSync(path, content, "utf8");
  return path;
}

export function gardenAndPersistLessons(
  root: string,
  config: LessonsPolicyConfig,
  now = new Date(),
): Promise<{ report: GardenReport; markdownPath: string | null }> {
  return gardenLessons(root, config, now).then((report) => {
    if (!config.syncRulesFile) {
      return { report, markdownPath: null };
    }
    const lessons = readProjectLessons(root);
    const path = renderLessonsMarkdown(root, lessons, config.maxCharsSession);
    return { report, markdownPath: path };
  });
}
