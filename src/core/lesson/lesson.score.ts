import type { HarnessLesson } from "./lesson.types.ts";

const MS_PER_HOUR = 3_600_000;

// hazard: an unparseable or missing timestamp used to yield NaN, which does not throw but poisons every
// comparator that sorts on the decayed value. Unknown reads as "just seen", which is the conservative side.
export function hoursSince(iso: string, now: Date): number {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) {
    return 0;
  }
  return Math.max(0, (now.getTime() - then) / MS_PER_HOUR);
}

/**
 * invariant: decay is measured from `lastSeenAt` — the last time the failure actually recurred — and never
 * from `lastAccessedAt`.
 *
 * hazard: `lastAccessedAt` is written by `touchAccessed` when a lesson is *selected for injection*, so
 * reading it here made relevance self-fulfilling: showing a lesson reset the clock that decided whether to
 * keep showing it. Any lesson matching a gate name became immortal and never pruned.
 */
export function decayedConfidence(lesson: HarnessLesson, decayLambda: number, now: Date): number {
  if (lesson.source === "core") {
    return lesson.confidence;
  }
  return lesson.confidence * Math.exp(-decayLambda * hoursSince(lesson.lastSeenAt, now));
}

export function relevanceScore(lesson: HarnessLesson, args: { gate?: string; text?: string }): number {
  let score = 0.25;
  const gate = (args.gate ?? "").toLowerCase();
  const text = (args.text ?? "").toLowerCase();
  if (gate && lesson.failedGate.toLowerCase() === gate) {
    score += 1.2;
  }
  if (gate && lesson.triggerTokens.some((token) => gate.includes(token.toLowerCase()))) {
    score += 0.35;
  }
  for (const token of lesson.triggerTokens) {
    const t = token.toLowerCase();
    if (t && text.includes(t)) {
      score += 0.2;
    }
  }
  score += lesson.priority / 200;
  return score;
}

export function rankScore(
  lesson: HarnessLesson,
  args: { gate?: string; text?: string; decayLambda: number; projectBoost: number; now?: Date },
): number {
  const now = args.now ?? new Date();
  const relevance = relevanceScore(lesson, { gate: args.gate, text: args.text });
  const confidence = decayedConfidence(lesson, args.decayLambda, now);
  // why: the boost favours the nearest tier. A lesson written for this repository outranks one carried in from
  // another product, which is what keeps a cross-product tier from drowning local knowledge.
  const boost = lesson.tier === "project" ? args.projectBoost : 1;
  return relevance * confidence * boost;
}
