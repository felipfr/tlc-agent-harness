import { coreFacade } from "../src/core/index.ts";
import { rankScore } from "../src/core/lesson/lesson.score.ts";
import { allLessons, lessonsStorePath } from "../src/core/lesson/lesson.store.ts";
import type { HarnessLesson } from "../src/core/lesson/lesson.types.ts";
import { loadPolicy } from "../src/core/policy/policy.loader.ts";
import type { LessonsPolicyConfig } from "../src/core/policy/policy.types.ts";
import { emitJson, takeJsonFlag } from "../src/platform/cli-output.ts";

export type LessonRow = {
  id: string;
  status: string;
  score: number;
  gate: string;
  hits: number;
  source: string;
  instruction: string;
};

export type LessonsListReport = {
  count: number;
  storePath: string;
  config: { enabled: boolean; promoteHitCount: number; syncRulesFile: boolean };
  lessons: LessonRow[];
};

export function lessonRows(
  lessons: readonly HarnessLesson[],
  config: LessonsPolicyConfig,
  now: Date,
): LessonRow[] {
  return lessons.map((lesson) => ({
    id: lesson.id,
    status: lesson.status,
    score: rankScore(lesson, {
      decayLambda: config.decayLambda,
      projectBoost: config.projectBoost,
      now,
    }),
    gate: lesson.failedGate,
    hits: lesson.hitCount,
    source: lesson.source,
    instruction: lesson.instruction,
  }));
}

export function listReport(
  root: string,
  lessons: readonly HarnessLesson[],
  config: LessonsPolicyConfig,
  now: Date,
): LessonsListReport {
  return {
    count: lessons.length,
    storePath: lessonsStorePath(root),
    config: {
      enabled: config.enabled,
      promoteHitCount: config.promoteHitCount,
      syncRulesFile: config.syncRulesFile,
    },
    lessons: lessonRows(lessons, config, now),
  };
}

export function listText(report: LessonsListReport): string {
  const lines: string[] = [];
  for (const row of report.lessons) {
    lines.push(
      `${row.status.padEnd(10)} ${row.score.toFixed(3).padStart(7)}  ${row.id}  gate=${row.gate} hits=${row.hits} src=${row.source}`,
    );
    lines.push(`           ${row.instruction.slice(0, 120)}`);
  }
  lines.push(`\n${report.count} lesson(s). Store: ${report.storePath}`);
  lines.push(
    `enabled=${report.config.enabled} promoteHitCount=${report.config.promoteHitCount} syncRulesFile=${report.config.syncRulesFile}`,
  );
  return lines.join("\n");
}

function usage(): never {
  console.log(`tlc harness lessons — durable gate lessons

  tlc harness lessons add "<instruction>" [--gate <name>] [--avoid "..."] [--prefer "..."] [--tokens a,b]
  tlc harness lessons list [--all] [--json]
  tlc harness lessons show <id> [--json]
  tlc harness lessons garden [--json]
  tlc harness lessons sync-rules [--json]
  tlc harness lessons path [--json]
`);
  process.exit(1);
}

/** why: the value after a named flag, so an instruction can carry spaces without shell quoting gymnastics. */
export function flagValue(argv: readonly string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  const value = at >= 0 ? argv[at + 1] : undefined;
  return value === undefined || value.startsWith("--") ? undefined : value;
}

/** why: the instruction is everything before the first flag, so `add "a b c" --gate test` reads naturally. */
export function positionalWords(argv: readonly string[]): string {
  const stop = argv.findIndex((token) => token.startsWith("--"));
  return (stop >= 0 ? argv.slice(0, stop) : argv).join(" ").trim();
}

async function main(argv: string[]): Promise<void> {
  const { json, rest } = takeJsonFlag(argv);
  const root = process.env.TLC_PROJECT_DIR ?? process.cwd();
  const config = loadPolicy(root).intelligence.lessons;
  const cmd = (rest[0] ?? "list").toLowerCase();

  if (cmd === "-h" || cmd === "--help" || cmd === "help") {
    usage();
  }

  if (cmd === "path") {
    if (json) {
      emitJson({ path: lessonsStorePath(root) });
    } else {
      console.log(lessonsStorePath(root));
    }
    return;
  }

  if (cmd === "list") {
    const includeAll = rest.includes("--all");
    const lessons = allLessons(root).filter((l) => includeAll || l.status !== "quarantine");
    const report = listReport(root, lessons, config, new Date());
    if (json) {
      emitJson(report);
    } else {
      console.log(listText(report));
    }
    return;
  }

  if (cmd === "show") {
    const id = rest[1];
    if (!id) {
      usage();
    }
    const lesson = allLessons(root).find((l) => l.id === id);
    if (!lesson) {
      if (json) {
        emitJson({ error: `not found: ${id}`, id });
      } else {
        console.error(`not found: ${id}`);
      }
      process.exit(1);
    }
    if (json) {
      emitJson(lesson);
    } else {
      console.log(JSON.stringify(lesson, null, 2));
    }
    return;
  }

  if (cmd === "add") {
    const instruction = positionalWords(rest.slice(1));
    if (!instruction) {
      console.error(
        'usage: tlc harness lessons add "<what to do differently>" [--gate <name>] [--avoid "..."]',
      );
      console.error("  The instruction is what gets injected, so write it as an instruction.");
      process.exit(1);
    }
    const lesson = coreFacade.lesson.buildAuthoredLesson({
      instruction,
      gate: flagValue(rest, "--gate"),
      avoid: flagValue(rest, "--avoid"),
      prefer: flagValue(rest, "--prefer"),
      triggerTokens: (flagValue(rest, "--tokens") ?? "").split(",").filter(Boolean),
      // why: recorded, not refused. An agent that cannot write down what it learned writes nothing down, which is
      // the state this replaces — marking it is what keeps it auditable
      // ([/decisions/ad-035.md](/decisions/ad-035.md)).
      inAgentSession: process.env.TLC_ACTIVE === "1",
    });
    const saved = await coreFacade.lesson.upsertProjectLesson(root, lesson);
    if (json) {
      emitJson(saved);
    } else {
      console.log(`lesson recorded (${saved.id}, ${saved.category})`);
      console.log(`  ${saved.instruction}`);
      console.log(`  gate: ${saved.failedGate} — injected at session start and on a matching retry`);
    }
    return;
  }

  if (cmd === "garden") {
    const { report, markdownPath } = await coreFacade.lesson.gardenAndPersistLessons(root, config);
    if (json) {
      emitJson({ report, markdownPath });
    } else {
      console.log(JSON.stringify(report, null, 2));
      if (markdownPath) {
        console.log(`synced rules → ${markdownPath}`);
      }
    }
    return;
  }

  if (cmd === "sync-rules") {
    const path = coreFacade.lesson.renderLessonsMarkdown(root, allLessons(root), config.maxCharsSession);
    const projectLessons = coreFacade.lesson.readProjectLessons(root).length;
    if (json) {
      emitJson({ path, projectLessons });
    } else {
      console.log(`wrote ${path}`);
      console.log(`project lessons: ${projectLessons}; core included in ranking only`);
    }
    return;
  }

  usage();
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
