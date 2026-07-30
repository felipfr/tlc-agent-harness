import type { LessonsPolicyConfig } from "../policy/policy.types.ts";
import { rankScore } from "./lesson.score.ts";
import { allLessons, touchAccessed } from "./lesson.store.ts";
import type { HarnessLesson } from "./lesson.types.ts";

export type SelectMode = "session" | "retry";

const OMIT_NOTE_RESERVE = 96;

function allowedForMode(lesson: HarnessLesson, mode: SelectMode, gate?: string): boolean {
  if (lesson.status === "quarantine") {
    return false;
  }
  if (mode === "session") {
    return lesson.status === "active";
  }
  if (lesson.status === "active") {
    return !gate || lesson.failedGate === gate || lesson.failedGate === "stagnation";
  }
  if (lesson.status === "candidate") {
    return Boolean(gate) && lesson.failedGate === gate;
  }
  return false;
}

export function renderLessonBlock(lesson: HarnessLesson): string {
  const lines = [
    `- [${lesson.failedGate}/${lesson.status}] ${lesson.instruction}`,
    `  avoid: ${lesson.avoid}`,
    `  prefer: ${lesson.prefer}`,
    `  before retrying: ${lesson.preRetryCheck}`,
  ];
  return lines.join("\n");
}

export function formatLessonsSection(lessons: HarnessLesson[], title: string): string {
  if (lessons.length === 0) {
    return "";
  }
  return [title, ...lessons.map((lesson) => renderLessonBlock(lesson))].join("\n");
}

export function omitLessonsNote(omitted: number): string {
  if (omitted <= 0) {
    return "";
  }
  const noun = omitted === 1 ? "lesson" : "lessons";
  return `_(${omitted} more active ${noun} omitted under char budget)_`;
}

export function packLessonsUnderBudget(args: { lessons: HarnessLesson[]; maxChars: number; title: string }): {
  body: string;
  included: HarnessLesson[];
  omitted: number;
} {
  const { lessons, title } = args;
  const maxChars = Math.max(0, args.maxChars);
  if (lessons.length === 0) {
    return { body: "", included: [], omitted: 0 };
  }

  const packBudget = Math.max(0, maxChars - OMIT_NOTE_RESERVE);
  const included: HarnessLesson[] = [];

  for (const lesson of lessons) {
    const candidate = formatLessonsSection([...included, lesson], title);
    if (included.length === 0) {
      included.push(lesson);
      if (candidate.length > packBudget) {
        break;
      }
      continue;
    }
    if (candidate.length <= packBudget) {
      included.push(lesson);
      continue;
    }
    break;
  }

  let omitted = lessons.length - included.length;
  let body = formatLessonsSection(included, title);
  const note = omitLessonsNote(omitted);
  if (!note) {
    return { body, included, omitted };
  }

  const withNote = `${body}\n${note}`;
  if (withNote.length <= maxChars) {
    return { body: withNote, included, omitted };
  }

  while (included.length > 1) {
    included.pop();
    omitted = lessons.length - included.length;
    body = formatLessonsSection(included, title);
    const next = `${body}\n${omitLessonsNote(omitted)}`;
    if (next.length <= maxChars) {
      return { body: next, included: [...included], omitted };
    }
  }

  return { body, included: [...included], omitted: lessons.length - included.length };
}

export function rankLessonsForSync(lessons: HarnessLesson[]): HarnessLesson[] {
  return [...lessons]
    .filter((lesson) => lesson.status === "active")
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        b.hitCount - a.hitCount ||
        b.confidence - a.confidence ||
        new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime() ||
        a.id.localeCompare(b.id),
    );
}

export async function selectLessons(args: {
  projectDir: string;
  config: LessonsPolicyConfig;
  mode: SelectMode;
  gate?: string;
  text?: string;
  now?: Date;
}): Promise<{ lessons: HarnessLesson[]; usedIds: string[] }> {
  if (!args.config.enabled) {
    return { lessons: [], usedIds: [] };
  }

  const maxCount = args.mode === "session" ? args.config.maxInjectSession : args.config.maxInjectRetry;
  const maxChars = args.mode === "session" ? args.config.maxCharsSession : args.config.maxCharsRetry;
  const now = args.now ?? new Date();

  const ranked = allLessons(args.projectDir)
    .filter((lesson) => allowedForMode(lesson, args.mode, args.gate))
    .map((lesson) => ({
      lesson,
      score: rankScore(lesson, {
        gate: args.gate,
        text: args.text,
        decayLambda: args.config.decayLambda,
        projectBoost: args.config.projectBoost,
        now,
      }),
    }))
    .sort((a, b) => b.score - a.score || b.lesson.priority - a.lesson.priority);

  const picked: HarnessLesson[] = [];
  let chars = 0;
  for (const row of ranked) {
    if (picked.length >= maxCount) {
      break;
    }
    const block = renderLessonBlock(row.lesson);
    if (chars + block.length > maxChars && picked.length > 0) {
      break;
    }
    if (block.length > maxChars && picked.length === 0) {
      picked.push(row.lesson);
      break;
    }
    picked.push(row.lesson);
    chars += block.length;
  }

  const usedIds = picked.filter((l) => l.source !== "core").map((l) => l.id);
  await touchAccessed(args.projectDir, usedIds, now);
  return { lessons: picked, usedIds: picked.map((l) => l.id) };
}
