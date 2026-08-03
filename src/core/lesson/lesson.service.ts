import { createHash } from "node:crypto";
import type { FailureCategory } from "../gate/gate.types.ts";
import { readProjectLessons, upsertProjectLesson } from "./lesson.store.ts";
import type { HarnessLesson } from "./lesson.types.ts";

function lessonId(gate: string, fingerprint: string): string {
  const digest = createHash("sha256").update(`${gate}|${fingerprint}`).digest("hex").slice(0, 12);
  return `project:${gate}:${digest}`;
}

function tokensFrom(gate: string, output: string, category: string): string[] {
  const tokens = new Set<string>([gate, category]);
  for (const line of output.split("\n").slice(0, 20)) {
    for (const word of line.toLowerCase().match(/[a-z][a-z0-9_./-]{2,}/g) ?? []) {
      if (word.length <= 40) {
        tokens.add(word);
      }
      if (tokens.size >= 16) {
        break;
      }
    }
    if (tokens.size >= 16) {
      break;
    }
  }
  return [...tokens];
}

// hazard: `suggestion` used to be a parameter here and was prefixed onto `instruction`. The consumer prints
// next_action from the same suggestionFor(category, gate) call, so every lesson opened by restating the line
// the gate had already emitted — duplicated by construction, spending the lessons budget on an echo. What a
// lesson uniquely knows is the recurring signature and the retry guidance, so that is all it carries.
export async function recordLessonFromFailure(args: {
  projectDir: string;
  gate: string;
  category: FailureCategory;
  fingerprint: string;
  output: string;
}): Promise<HarnessLesson> {
  const now = new Date().toISOString();
  const id = lessonId(args.gate, args.fingerprint);
  const existing = readProjectLessons(args.projectDir).find((item) => item.id === id);
  const snippet = args.output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" | ")
    .slice(0, 220);

  if (existing) {
    const updated: HarnessLesson = {
      ...existing,
      hitCount: existing.hitCount + 1,
      lastSeenAt: now,
      lastAccessedAt: now,
      updatedAt: now,
      confidence: Math.min(1, existing.confidence + 0.08),
      triggerTokens: snippet
        ? [
            ...new Set([...existing.triggerTokens, ...tokensFrom(args.gate, args.output, args.category)]),
          ].slice(0, 16)
        : existing.triggerTokens,
    };
    return upsertProjectLesson(args.projectDir, updated);
  }

  const lesson: HarnessLesson = {
    id,
    scope: "gate-execution",
    failedGate: args.gate,
    category: args.category,
    triggerTokens: tokensFrom(args.gate, args.output, args.category),
    instruction: `Recurrent failure signature on gate "${args.gate}".${snippet ? ` Signal: ${snippet}` : ""}`,
    avoid: "Do not repeat the same failing edit, suppression, or command that produced this fingerprint.",
    prefer: "Change approach using the gate output; verify with the same gate before claiming done.",
    preRetryCheck: `Re-read the ${args.gate} output and confirm the next edit targets a different root cause.`,
    source: "project",
    status: "candidate",
    confidence: 0.55,
    hitCount: 1,
    priority: 70,
    projectScoped: true,
    firstSeenAt: now,
    lastSeenAt: now,
    lastAccessedAt: now,
    updatedAt: now,
  };
  return upsertProjectLesson(args.projectDir, lesson);
}
