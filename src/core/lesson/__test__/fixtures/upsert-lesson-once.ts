import { upsertProjectLesson } from "../../lesson.store.ts";
import type { HarnessLesson } from "../../lesson.types.ts";

const [, , root, id] = process.argv;
if (!root || !id) {
  console.error("usage: upsert-lesson-once.ts <root> <id>");
  process.exit(1);
}

const now = new Date().toISOString();
const lesson: HarnessLesson = {
  id,
  scope: "gate-execution",
  failedGate: "test",
  category: "test",
  triggerTokens: ["test"],
  instruction: `lesson ${id}`,
  avoid: "do not guess",
  prefer: "read the assertion",
  preRetryCheck: "check the failing test",
  source: "project",
  status: "candidate",
  confidence: 0.5,
  hitCount: 1,
  priority: 50,
  projectScoped: true,
  firstSeenAt: now,
  lastSeenAt: now,
  lastAccessedAt: now,
  updatedAt: now,
};

await upsertProjectLesson(root, lesson);
