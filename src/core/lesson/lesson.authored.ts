import { createHash } from "node:crypto";
import type { HarnessLesson, LessonLink, LessonTier } from "./lesson.types.ts";

/**
 * The lesson store had exactly one producer: gate stagnation. So a lesson learned by *reasoning* — a code review, an
 * incident, an operator's correction, a pattern noticed across several changes — had no way in, while the mechanism
 * that would have carried it (ranked injection with recurrence decay) already existed and ran every session
 * ([/decisions/ad-035.md](/decisions/ad-035.md)).
 *
 * invariant: this knows nothing about where a lesson came from in the world. No document layout, no decision-record
 * convention, no directory. The harness ships the mechanism; a project decides what feeds it. Reading a repository's
 * documentation to harvest lessons would couple every install to one project's filing habits.
 *
 * why: `source: "manual"` was already in `LessonSource` and produced by nothing — the union anticipated this route and
 * it was never built.
 */
export type AuthoredLessonInput = {
  /** The one thing to do differently. This is what gets injected, so it is written as an instruction. */
  instruction: string;
  /** What went wrong, in the author's words. Empty is allowed — an instruction alone is still useful. */
  avoid?: string;
  prefer?: string;
  preRetryCheck?: string;
  /**
   * The gate this applies to, when it applies to one. Ranking boosts a lesson whose gate matches the failing gate,
   * and session-mode injection includes every lesson regardless — so a lesson about no particular gate still arrives.
   */
  gate?: string;
  /** Words that should pull this lesson up when they appear in the failure text. */
  triggerTokens?: string[];
  /** What makes this lesson true. When any ref breaks, `garden` stops the lesson being injected. */
  refs?: LessonLink[];
  /** ISO bound after which this lesson stops being injected. */
  validTo?: string;
  tier?: Exclude<LessonTier, "core">;
  /** A standing rule: injected before every scored lesson rather than competing with them. */
  pinned?: boolean;
  /**
   * True when the command ran inside an agent session. Recorded rather than refused: an agent that cannot write down
   * what it learned writes nothing down, which is the state this replaces. Marking it is what keeps it auditable.
   */
  inAgentSession?: boolean;
  now?: string;
};

/** why: a stable id from the instruction, so writing the same lesson twice updates rather than duplicates. */
export function authoredLessonId(instruction: string): string {
  const digest = createHash("sha256").update(instruction.trim().toLowerCase()).digest("hex").slice(0, 12);
  return `manual:${digest}`;
}

export const AUTHORED_GATE = "any";

export function buildAuthoredLesson(input: AuthoredLessonInput): HarnessLesson {
  const now = input.now ?? new Date().toISOString();
  const instruction = input.instruction.trim();
  return {
    id: authoredLessonId(instruction),
    scope: "gate-execution",
    // why: `any` rather than a real gate name, so a retry for a specific gate is not falsely boosted by a lesson that
    // was never about it. Session-mode injection carries it anyway.
    failedGate: input.gate?.trim() || AUTHORED_GATE,
    category: input.inAgentSession ? "authored-in-session" : "authored",
    triggerTokens: (input.triggerTokens ?? []).map((token) => token.trim().toLowerCase()).filter(Boolean),
    instruction,
    avoid: input.avoid?.trim() ?? "",
    prefer: input.prefer?.trim() ?? "",
    preRetryCheck: input.preRetryCheck?.trim() ?? "",
    source: "manual",
    tier: input.tier ?? "project",
    // why: `active`, not `candidate`. A candidate exists because the automatic producer is guessing from output; an
    // author is not guessing, and making them wait for a promotion threshold that only recurrence can satisfy would
    // mean an authored lesson never activates.
    status: "active",
    confidence: 0.8,
    hitCount: 1,
    // hazard: this was `0.8`, written as if priority were the 0..1 scale `confidence` uses. Every other producer
    // is 70..100 and `relevanceScore` divides by 200, so an authored lesson contributed 0.004 where a core lesson
    // contributes 0.45 — ranked below everything, always, and never injected under a real char budget.
    priority: 80,
    pinned: input.pinned === true,
    refs: input.refs ?? [],
    ...(input.validTo ? { validTo: input.validTo } : {}),
    // why: an authored lesson has no failing session behind it, so it carries none. Promotion reads distinct
    // sessions and an authored lesson is already active, so it never consults this.
    sessionKeys: [],
    injectedCount: 0,
    gradeableCount: 0,
    helpedCount: 0,
    neutralCount: 0,
    firstSeenAt: now,
    lastSeenAt: now,
    lastAccessedAt: now,
    updatedAt: now,
  };
}
