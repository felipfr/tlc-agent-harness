import type { HarnessLesson, LessonEffectiveness } from "./lesson.types.ts";

export type LessonVerdict = "helped" | "neutral";

export function gradedCount(lesson: HarnessLesson): number {
  return lesson.helpedCount + lesson.neutralCount;
}

// invariant: a rate over zero graded injections is null, not zero. Zero reads as "measured and it never helped";
// null is the only honest value for "nothing has tested this yet".
export function helpRate(lesson: HarnessLesson): number | null {
  const graded = gradedCount(lesson);
  return graded === 0 ? null : lesson.helpedCount / graded;
}

/**
 * hazard: this read `injectedCount`, which counts session-start injections. Those are never graded — a lesson
 * whose gate is `any` is not even eligible on a retry — so a healthy pinned standing rule reported `unproven`
 * forever and `doctor` warned about it on every run, in every repository
 * ([/decisions/ad-044.md](/decisions/ad-044.md)).
 */
export function lessonEffectiveness(lesson: HarnessLesson): LessonEffectiveness {
  const rate = helpRate(lesson);
  if (rate === null) {
    // why: only an injection a gate could have graded can be unproven. Everything else has had no opportunity.
    return lesson.gradeableCount === 0 ? "not-injected" : "unproven";
  }
  return rate > 0 ? "helped" : "neutral";
}

export function creditLesson(lesson: HarnessLesson, verdict: LessonVerdict, now: string): HarnessLesson {
  return {
    ...lesson,
    helpedCount: lesson.helpedCount + (verdict === "helped" ? 1 : 0),
    neutralCount: lesson.neutralCount + (verdict === "neutral" ? 1 : 0),
    updatedAt: now,
  };
}

export function effectivenessLine(lesson: HarnessLesson): string {
  const reading = lessonEffectiveness(lesson);
  if (reading === "not-injected") {
    return lesson.injectedCount === 0
      ? "not-injected"
      : `session-only (injected ${lesson.injectedCount}x, never for a gate)`;
  }
  if (reading === "unproven") {
    return `unproven (injected for a gate ${lesson.gradeableCount}x, graded 0x)`;
  }
  return `${reading} ${lesson.helpedCount}/${gradedCount(lesson)}`;
}
