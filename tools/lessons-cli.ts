import { coreFacade } from "../src/core/index.ts";
import { rankScore } from "../src/core/lesson/lesson.score.ts";
import { allLessons, lessonsStorePath } from "../src/core/lesson/lesson.store.ts";
import { loadPolicy } from "../src/core/policy/policy.loader.ts";

const root = process.env.TLC_PROJECT_DIR ?? process.cwd();
const config = loadPolicy(root).intelligence.lessons;
const args = process.argv.slice(2);
const cmd = (args[0] ?? "list").toLowerCase();

function usage(): never {
  console.log(`tlc harness lessons — durable gate lessons

  tlc harness lessons list [--all]
  tlc harness lessons show <id>
  tlc harness lessons garden
  tlc harness lessons sync-rules
  tlc harness lessons path
`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (cmd === "-h" || cmd === "--help" || cmd === "help") {
    usage();
  }

  if (cmd === "path") {
    console.log(lessonsStorePath(root));
    return;
  }

  if (cmd === "list") {
    const includeAll = args.includes("--all");
    const lessons = allLessons(root).filter((l) => includeAll || l.status !== "quarantine");
    const now = new Date();
    for (const lesson of lessons) {
      const score = rankScore(lesson, {
        decayLambda: config.decayLambda,
        projectBoost: config.projectBoost,
        now,
      });
      console.log(
        `${lesson.status.padEnd(10)} ${score.toFixed(3).padStart(7)}  ${lesson.id}  gate=${lesson.failedGate} hits=${lesson.hitCount} src=${lesson.source}`,
      );
      console.log(`           ${lesson.instruction.slice(0, 120)}`);
    }
    console.log(`\n${lessons.length} lesson(s). Store: ${lessonsStorePath(root)}`);
    console.log(
      `enabled=${config.enabled} promoteHitCount=${config.promoteHitCount} syncRulesFile=${config.syncRulesFile}`,
    );
    return;
  }

  if (cmd === "show") {
    const id = args[1];
    if (!id) {
      usage();
    }
    const lesson = allLessons(root).find((l) => l.id === id);
    if (!lesson) {
      console.error(`not found: ${id}`);
      process.exit(1);
    }
    console.log(JSON.stringify(lesson, null, 2));
    return;
  }

  if (cmd === "garden") {
    const { report, markdownPath } = await coreFacade.lesson.gardenAndPersistLessons(root, config);
    console.log(JSON.stringify(report, null, 2));
    if (markdownPath) {
      console.log(`synced rules → ${markdownPath}`);
    }
    return;
  }

  if (cmd === "sync-rules") {
    const path = coreFacade.lesson.renderLessonsMarkdown(root, allLessons(root), config.maxCharsSession);
    console.log(`wrote ${path}`);
    console.log(
      `project lessons: ${coreFacade.lesson.readProjectLessons(root).length}; core included in ranking only`,
    );
    return;
  }

  usage();
}

await main();
