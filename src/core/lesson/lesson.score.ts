import type { HarnessLesson } from "./lesson.types.ts";

const MS_PER_HOUR = 3_600_000;

export function hoursSince(iso: string, now: Date): number {
  const delta = now.getTime() - new Date(iso).getTime();
  return Math.max(0, delta / MS_PER_HOUR);
}

export function decayedConfidence(lesson: HarnessLesson, decayLambda: number, now: Date): number {
  if (lesson.source === "core") {
    return lesson.confidence;
  }
  const hours = hoursSince(lesson.lastAccessedAt || lesson.lastSeenAt, now);
  return lesson.confidence * Math.exp(-decayLambda * hours);
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
  const boost = lesson.projectScoped ? args.projectBoost : 1;
  return relevance * confidence * boost;
}
