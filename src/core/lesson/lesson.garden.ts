import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { projectConfigPath } from "../../platform/paths.ts";
import { isCommandResolutionFailure } from "../gate/gate.command.ts";
import type { LessonsPolicyConfig } from "../policy/policy.types.ts";
import { lessonLinkVerdict } from "./lesson.link.ts";
import { hoursSince } from "./lesson.score.ts";
import { isInjectable, packLessonsUnderBudget, rankLessonsForSync } from "./lesson.select.ts";
import { gardenGlobalLessons, gardenProjectLessons, readProjectLessons } from "./lesson.store.ts";
import type { HarnessLesson } from "./lesson.types.ts";
import { validityReason } from "./lesson.validity.ts";

export type GardenReport = {
  promoted: string[];
  quarantined: string[];
  pruned: string[];
  /** Project lessons whose refs no longer resolve. Reported, never auto-deleted — a rename can be reverted. */
  stale: string[];
  /** Lessons whose staleness cleared because every ref resolves again. */
  refreshed: string[];
  expired: string[];
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

/**
 * invariant: promotion counts distinct sessions. `hitCount` counts fingerprint recurrences, which one stuck
 * session can drive to any number, so it promoted lessons that had occurred once in the world.
 *
 * why: a record written before `sessionKeys` existed has none, and falling back to `hitCount` is what keeps it
 * promotable rather than frozen as a candidate forever.
 */
export function promotionCount(lesson: HarnessLesson): number {
  return lesson.sessionKeys.length > 0 ? lesson.sessionKeys.length : lesson.hitCount;
}

type StaleOutcome = { lesson: HarnessLesson; marked: boolean; cleared: boolean };

/**
 * invariant: only the tier whose store shares this repository is graded. A global lesson is read from many
 * repositories, so one persisted flag cannot be true for all of them — that case is decided per repository at
 * selection time instead.
 */
function applyStaleness(root: string, lesson: HarnessLesson, now: Date): StaleOutcome {
  if (lesson.tier !== "project" || lesson.refs.length === 0) {
    return { lesson, marked: false, cleared: false };
  }
  const verdict = lessonLinkVerdict(root, lesson.refs);
  const checkedAt = now.toISOString();
  if (verdict.stale) {
    return {
      lesson: { ...lesson, staleReason: verdict.status, staleCheckedAt: checkedAt, updatedAt: checkedAt },
      marked: lesson.staleReason === undefined,
      cleared: false,
    };
  }
  if (lesson.staleReason === undefined) {
    return { lesson: { ...lesson, staleCheckedAt: checkedAt }, marked: false, cleared: false };
  }
  const { staleReason: _dropped, ...rest } = lesson;
  return {
    lesson: { ...rest, staleCheckedAt: checkedAt, updatedAt: checkedAt },
    marked: false,
    cleared: true,
  };
}

function gardenOne(
  root: string,
  lesson: HarnessLesson,
  config: LessonsPolicyConfig,
  now: Date,
  report: GardenReport,
): HarnessLesson | null {
  if (isStaleResolutionMisfile(lesson)) {
    report.pruned.push(lesson.id);
    return null;
  }

  // why: an expired lesson is the one case the author already decided. Prune it, unlike a broken ref, which is
  // a filesystem observation that a revert could undo.
  if (validityReason(lesson, now) === "expired") {
    report.expired.push(lesson.id);
    return null;
  }

  const outcome = applyStaleness(root, lesson, now);
  let candidate = outcome.lesson;
  if (outcome.marked) {
    report.stale.push(candidate.id);
  }
  if (outcome.cleared) {
    report.refreshed.push(candidate.id);
  }

  if (candidate.status === "candidate" && promotionCount(candidate) >= config.promoteHitCount) {
    candidate = {
      ...candidate,
      status: "active",
      confidence: Math.max(candidate.confidence, 0.7),
      updatedAt: now.toISOString(),
    };
    report.promoted.push(candidate.id);
  }

  const idleHours = hoursSince(candidate.lastSeenAt, now);
  if (
    candidate.status === "active" &&
    idleHours > 24 * 90 &&
    promotionCount(candidate) < config.promoteHitCount
  ) {
    candidate = { ...candidate, status: "quarantine", updatedAt: now.toISOString() };
    report.quarantined.push(candidate.id);
  }

  if (candidate.status === "quarantine" && idleHours > 24 * 180) {
    report.pruned.push(candidate.id);
    return null;
  }

  // invariant: pruning measures the same clock the ranking does — recurrence, not injection. Reading
  // lastAccessedAt here let an injected lesson postpone its own pruning indefinitely.
  const decayed =
    candidate.confidence * Math.exp(-config.decayLambda * hoursSince(candidate.lastSeenAt, now));
  if (decayed < 0.05 && candidate.status !== "quarantine" && candidate.hitCount < 2) {
    report.pruned.push(candidate.id);
    return null;
  }

  return candidate;
}

function emptyReport(): GardenReport {
  return {
    promoted: [],
    quarantined: [],
    pruned: [],
    stale: [],
    refreshed: [],
    expired: [],
    active: 0,
    candidates: 0,
  };
}

export async function gardenLessons(
  root: string,
  config: LessonsPolicyConfig,
  now = new Date(),
): Promise<GardenReport> {
  const report = emptyReport();
  const sweep = (current: HarnessLesson[]): HarnessLesson[] => {
    const next: HarnessLesson[] = [];
    for (const lesson of current) {
      if (lesson.source === "core") {
        continue;
      }
      const kept = gardenOne(root, lesson, config, now, report);
      if (kept) {
        next.push(kept);
      }
    }
    return next;
  };

  const project = await gardenProjectLessons(root, sweep);
  // why: the global tier is gardened in the same pass. Decay, promotion and expiry apply to it identically;
  // only staleness is tier-specific, and `applyStaleness` is what draws that line.
  const global = await gardenGlobalLessons(sweep);
  const kept = [...project, ...global];

  report.active = kept.filter((l) => l.status === "active").length;
  report.candidates = kept.filter((l) => l.status === "candidate").length;
  return report;
}

const SYNC_TITLE = "Learned harness lessons (auto-synced; do not hand-edit):";

export function lessonsMarkdownPath(root: string): string {
  return join(dirname(projectConfigPath(root)), "lessons.md");
}

/**
 * Why the synced file has nothing in it, in the operator's terms.
 *
 * hazard: one sentence — "No active project lessons yet." — covered a switched-off capability, an enabled one that
 * had never seen a repeat failure, and a store full of candidates none of which had been promoted. Three different
 * situations and nothing to tell them apart, so the file read as broken. An operator reported it as never updating,
 * and it was being rewritten every session with the same empty text ([/decisions/ad-049.md](/decisions/ad-049.md)).
 */
export function emptySyncReason(
  lessons: readonly HarnessLesson[],
  config: LessonsPolicyConfig,
  now: Date,
): string {
  if (!config.enabled) {
    return "Lessons are switched off for this project (`intelligence.lessons.enabled` is false), so no gate failure is ever recorded. Ask the agent to run the harness-init skill to turn them on.";
  }
  if (lessons.length === 0) {
    return "No lesson recorded yet. One is written when the *same* gate failure repeats inside a session — a gate that fails once, or fails differently each time, records nothing.";
  }
  const candidates = lessons.filter((lesson) => lesson.status === "candidate").length;
  if (candidates > 0 && lessons.every((lesson) => lesson.status !== "active")) {
    const noun = candidates === 1 ? "lesson" : "lessons";
    return `${candidates} candidate ${noun} recorded, none promoted yet. Promotion needs the same failure in ${config.promoteHitCount} distinct sessions — see \`tlc harness lessons list\`.`;
  }
  const withheld = lessons.filter(
    (lesson) => lesson.status === "active" && !isInjectable(lesson, now),
  ).length;
  if (withheld > 0) {
    const noun = withheld === 1 ? "lesson is" : "lessons are";
    return `${withheld} active ${noun} withheld — a named reference stopped resolving, or a validity window closed. Run \`tlc harness lessons list\` to see which.`;
  }
  return "No active project lessons yet.";
}

export function renderLessonsMarkdown(
  root: string,
  lessons: HarnessLesson[],
  config: LessonsPolicyConfig,
): string {
  // invariant: the synced file is what an operator reads as current guidance, so it carries exactly what would
  // be injected — a withheld lesson appearing here would contradict the store.
  const now = new Date();
  const ranked = rankLessonsForSync(lessons.filter((lesson) => isInjectable(lesson, now))).slice(0, 12);
  const { body } = packLessonsUnderBudget({
    lessons: ranked,
    maxChars: config.maxCharsSession,
    title: SYNC_TITLE,
  });
  const path = lessonsMarkdownPath(root);
  mkdirSync(dirname(path), { recursive: true });
  const content = `# Harness lessons

Auto-synced from gate failures; do not hand-edit.

${body || emptySyncReason(lessons, config, now)}
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
    const path = renderLessonsMarkdown(root, lessons, config);
    return { report, markdownPath: path };
  });
}
