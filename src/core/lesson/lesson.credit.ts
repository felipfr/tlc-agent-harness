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

export function lessonEffectiveness(lesson: HarnessLesson): LessonEffectiveness {
  const rate = helpRate(lesson);
  if (rate === null) {
    // why: a lesson nothing has shown yet is not an unjustified claim — there has been no opportunity to measure
    // it. Folding the two together made every fresh store read as entirely unproven.
    return lesson.injectedCount === 0 ? "not-injected" : "unproven";
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
    return "not-injected";
  }
  if (reading === "unproven") {
    return `unproven (injected ${lesson.injectedCount}x, graded 0x)`;
  }
  return `${reading} ${lesson.helpedCount}/${gradedCount(lesson)}`;
}
