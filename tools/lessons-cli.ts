import { coreFacade } from "../src/core/index.ts";
import type { GardenReport } from "../src/core/lesson/lesson.garden.ts";
import { rankScore } from "../src/core/lesson/lesson.score.ts";
import { allLessons, lessonsStorePath } from "../src/core/lesson/lesson.store.ts";
import type { LessonsSyncMode } from "../src/core/lesson/lesson.sync.ts";
import type { HarnessLesson, LessonLink } from "../src/core/lesson/lesson.types.ts";
import { loadPolicy } from "../src/core/policy/policy.loader.ts";
import type { LessonsPolicyConfig } from "../src/core/policy/policy.types.ts";
import { emitJson, takeJsonFlag } from "../src/platform/cli-output.ts";
import { plural } from "./doctor.ts";

export type LessonRow = {
  id: string;
  status: string;
  score: number;
  gate: string;
  hits: number;
  source: string;
  tier: string;
  /** A standing rule, placed before every scored lesson rather than competing with them. */
  pinned: boolean;
  /** How many distinct sessions produced it — what promotion actually counts. */
  sessions: number;
  effectiveness: string;
  validity: string;
  stale: string | null;
  refs: string[];
  /** False when a stale ref, an expired window, or a global ref that misses here withholds it here. */
  injected: boolean;
  instruction: string;
};

export type LessonsListReport = {
  count: number;
  storePath: string;
  globalStorePath: string;
  config: {
    enabled: boolean;
    promoteHitCount: number;
    syncRulesFile: LessonsSyncMode;
    /** Present only while a config predating the mode is still in place. */
    syncRulesFileCoercedFrom?: boolean;
  };
  totals: {
    byTier: Record<string, number>;
    stale: number;
    outOfWindow: number;
    unproven: number;
    notInjected: number;
  };
  /**
   * What is on disk, which is not what `byTier` reports. A promoted lesson exists in both stores and resolves to
   * the project copy, so `byTier` shows it as `project` and the global tier reads as empty — from which an operator
   * concludes that `promote` did nothing ([/decisions/ad-042.md](/decisions/ad-042.md)).
   */
  stores: { project: number; global: number; shared: number };
  lessons: LessonRow[];
};

export function lessonRows(
  root: string,
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
    tier: lesson.tier,
    pinned: lesson.pinned,
    // why: the raw count, not `promotionCount`. That helper falls back to `hitCount` for a record written before
    // session keys existed, which made an authored lesson that never had a session report `sessions=1`.
    sessions: lesson.sessionKeys.length,
    effectiveness: coreFacade.lesson.effectivenessLine(lesson),
    validity: coreFacade.lesson.validityReason(lesson, now),
    stale: lesson.staleReason ?? null,
    refs: lesson.refs.map((ref) => coreFacade.lesson.formatLessonLink(ref)),
    injected: coreFacade.lesson.isInjectable(lesson, now) && coreFacade.lesson.appliesHere(root, lesson),
    instruction: lesson.instruction,
  }));
}

export function listReport(
  root: string,
  lessons: readonly HarnessLesson[],
  config: LessonsPolicyConfig,
  now: Date,
): LessonsListReport {
  const rows = lessonRows(root, lessons, config, now);
  const { coercedFrom } = coreFacade.policy.resolveProjectSyncMode(root);
  const byTier: Record<string, number> = {};
  for (const row of rows) {
    byTier[row.tier] = (byTier[row.tier] ?? 0) + 1;
  }
  const projectIds = new Set(coreFacade.lesson.readProjectLessons(root).map((lesson) => lesson.id));
  const globalIds = coreFacade.lesson.readGlobalLessons().map((lesson) => lesson.id);
  return {
    count: lessons.length,
    storePath: lessonsStorePath(root),
    globalStorePath: coreFacade.lesson.globalLessonsStorePath(),
    config: {
      enabled: config.enabled,
      promoteHitCount: config.promoteHitCount,
      syncRulesFile: config.syncRulesFile,
      // hazard: spread rather than assigned. An explicitly `undefined` property survives `deepEqual` and dies in
      // `JSON.stringify`, which is how the report stopped surviving its own round trip.
      ...(coercedFrom !== undefined ? { syncRulesFileCoercedFrom: coercedFrom } : {}),
    },
    totals: {
      byTier,
      stale: rows.filter((row) => row.stale !== null).length,
      outOfWindow: rows.filter((row) => row.validity !== "active").length,
      // invariant: injected-and-ungraded only. Counting never-injected lessons made a fresh store report every
      // lesson as unproven, which is a number nobody can act on.
      unproven: rows.filter((row) => row.effectiveness.startsWith("unproven")).length,
      notInjected: rows.filter((row) => row.effectiveness === "not-injected").length,
    },
    stores: {
      project: projectIds.size,
      global: globalIds.length,
      shared: globalIds.filter((id) => projectIds.has(id)).length,
    },
    lessons: rows,
  };
}

export function listText(report: LessonsListReport): string {
  const lines: string[] = [];
  for (const row of report.lessons) {
    const withheld = row.injected ? "" : "  WITHHELD";
    const pin = row.pinned ? "  PINNED" : "";
    lines.push(
      `${row.status.padEnd(10)} ${row.score.toFixed(3).padStart(7)}  ${row.id}  gate=${row.gate} tier=${row.tier} hits=${row.hits} sessions=${row.sessions} src=${row.source}${pin}${withheld}`,
    );
    lines.push(`           ${row.instruction.slice(0, 120)}`);
    const notes = [`effect=${row.effectiveness}`, `validity=${row.validity}`];
    if (row.stale) {
      notes.push(`stale=${row.stale}`);
    }
    if (row.refs.length > 0) {
      notes.push(`refs=${row.refs.join(",")}`);
    }
    lines.push(`           ${notes.join("  ")}`);
  }
  const tiers = Object.entries(report.totals.byTier)
    .map(([tier, count]) => `${tier}=${count}`)
    .join(" ");
  const noun = report.count === 1 ? "lesson" : "lessons";
  lines.push(`\n${report.count} ${noun} — ${tiers || "none"}`);
  lines.push(
    `stale=${report.totals.stale} out-of-window=${report.totals.outOfWindow} unproven=${report.totals.unproven} not-injected=${report.totals.notInjected}`,
  );
  // why: the counts above are what would be injected, after the nearer tier wins a duplicate id. These are what is
  // on disk, so `promote` is visible instead of looking like it did nothing.
  const shared = report.stores.shared > 0 ? `, ${report.stores.shared} also in this project` : "";
  lines.push(`project store: ${report.storePath}  (${plural(report.stores.project, "lesson")})`);
  lines.push(
    `global store:  ${report.globalStorePath}  (${plural(report.stores.global, "lesson")}${shared})`,
  );
  lines.push(
    `enabled=${report.config.enabled} promoteHitCount=${report.config.promoteHitCount} syncRulesFile=${report.config.syncRulesFile}`,
  );
  // why: the loader coerces silently so nothing breaks, and silence is how a config stays wrong for months. Named
  // once, next to the value it produced ([/decisions/ad-050.md](/decisions/ad-050.md)).
  if (report.config.syncRulesFileCoercedFrom !== undefined) {
    lines.push(
      `  syncRulesFile is still the old boolean ${report.config.syncRulesFileCoercedFrom} in .tlc/harness/config.json; it reads as ${report.config.syncRulesFile}. Set "auto" to let the provider decide.`,
    );
  }
  return lines.join("\n");
}

/**
 * why: the raw report was printed as JSON, so `"stale": ["manual:f70cc…"]` told an operator an id and not what
 * happened to it. Each line says what changed and what it means from now on
 * ([/decisions/ad-034.md](/decisions/ad-034.md)).
 */
export function gardenText(report: GardenReport): string {
  const lines: string[] = [];
  const say = (ids: readonly string[], what: string): void => {
    if (ids.length > 0) {
      lines.push(`${what}: ${ids.join(", ")}`);
    }
  };
  say(report.promoted, "promoted to active (seen in enough distinct sessions)");
  say(report.stale, "now withheld — a named path or symbol no longer resolves");
  say(report.refreshed, "no longer withheld — every named reference resolves again");
  say(report.expired, "pruned — past its validity window");
  say(report.quarantined, "quarantined — idle and never promoted");
  say(report.pruned, "pruned — decayed below the floor, or its cause can no longer recur");
  if (lines.length === 0) {
    lines.push("nothing changed");
  }
  lines.push(`${report.active} active, ${report.candidates} candidate(s) across the writable tiers`);
  return lines.join("\n");
}

function usage(): never {
  console.log(`tlc harness lessons — durable gate lessons

  Three tiers: core (shipped), global (this machine, every product), project (this repo).

  tlc harness lessons add "<instruction>" [--gate <name>] [--avoid "..."] [--prefer "..."]
                          [--tokens a,b] [--ref path[:symbol]] [--until <iso>] [--global] [--pin]
  tlc harness lessons promote <id>          copy a project lesson into the global tier
  tlc harness lessons list [--all] [--json]
  tlc harness lessons show <id> [--json]
  tlc harness lessons garden [--json]
  tlc harness lessons sync-rules [--json]
  tlc harness lessons path [--json]

  --ref names what makes the lesson true. When it stops resolving, the lesson stops being injected.
  --pin puts a standing rule ahead of every scored lesson instead of making it compete for rank.
`);
  process.exit(1);
}

/** why: the value after a named flag, so an instruction can carry spaces without shell quoting gymnastics. */
export function flagValue(argv: readonly string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  const value = at >= 0 ? argv[at + 1] : undefined;
  return value === undefined || value.startsWith("--") ? undefined : value;
}

/** why: `--ref` may repeat, because one lesson can be true of two files. */
export function flagValues(argv: readonly string[], flag: string): string[] {
  const out: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== flag) {
      continue;
    }
    const value = argv[index + 1];
    if (value !== undefined && !value.startsWith("--")) {
      out.push(value);
    }
  }
  return out;
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
    const tier = rest.includes("--global") ? "global" : "project";
    const refs = flagValues(rest, "--ref")
      .map((raw) => coreFacade.lesson.parseLessonLink(raw))
      .filter((ref): ref is LessonLink => ref !== null);
    const until = flagValue(rest, "--until");
    if (until !== undefined && !Number.isFinite(Date.parse(until))) {
      console.error(`--until is not a parseable date: ${until}`);
      process.exit(1);
    }
    // hazard: a past `--until` writes a lesson that can never be injected and that the next garden prunes. The
    // command reported success, so the operator learned nothing ([/decisions/ad-037.md](/decisions/ad-037.md)).
    if (until !== undefined && Date.parse(until) <= Date.now()) {
      console.error(`--until is already in the past: ${until}`);
      console.error(
        "Such a lesson is never injected and the next garden prunes it. Use a future date, or omit --until.",
      );
      process.exit(1);
    }
    const lesson = coreFacade.lesson.buildAuthoredLesson({
      instruction,
      gate: flagValue(rest, "--gate"),
      avoid: flagValue(rest, "--avoid"),
      prefer: flagValue(rest, "--prefer"),
      triggerTokens: (flagValue(rest, "--tokens") ?? "").split(",").filter(Boolean),
      refs,
      validTo: until,
      tier,
      pinned: rest.includes("--pin"),
      // why: recorded, not refused. An agent that cannot write down what it learned writes nothing down, which is
      // the state this replaces — marking it is what keeps it auditable
      // ([/decisions/ad-035.md](/decisions/ad-035.md)).
      inAgentSession: process.env.TLC_ACTIVE === "1",
    });
    const saved = await coreFacade.lesson.upsertLesson(root, lesson, tier);
    if (json) {
      emitJson(saved);
    } else {
      console.log(`lesson recorded (${saved.id}, ${saved.category}, tier=${saved.tier})`);
      console.log(`  ${saved.instruction}`);
      console.log(`  gate: ${saved.failedGate} — injected at session start and on a matching retry`);
      if (saved.refs.length > 0) {
        console.log(
          `  refs: ${saved.refs.map((ref) => coreFacade.lesson.formatLessonLink(ref)).join(", ")} — the lesson is withheld once one stops resolving`,
        );
      }
      if (saved.validTo) {
        console.log(`  valid until: ${saved.validTo}`);
      }
      if (saved.pinned) {
        console.log(`  pinned — injected before every scored lesson, still under the char budget`);
      }
      if (tier === "global") {
        console.log(`  written to the global tier — every product on this machine will read it`);
      }
    }
    return;
  }

  if (cmd === "promote") {
    const id = rest[1];
    if (!id) {
      console.error(
        "usage: tlc harness lessons promote <id>   (copies a project lesson into the global tier)",
      );
      process.exit(1);
    }
    const lesson = coreFacade.lesson.readProjectLessons(root).find((item) => item.id === id);
    if (!lesson) {
      console.error(`not a project lesson: ${id}`);
      console.error("Only a project lesson can be promoted. Core is shipped and global is already global.");
      process.exit(1);
    }
    const saved = await coreFacade.lesson.upsertLesson(root, lesson, "global");
    if (json) {
      emitJson(saved);
    } else {
      console.log(`promoted ${saved.id} to the global tier`);
      console.log(`  ${coreFacade.lesson.globalLessonsStorePath()}`);
      console.log(`  it stays in this project's store too; the nearer tier wins on rank`);
    }
    return;
  }

  if (cmd === "garden") {
    // why: run from a terminal, where there is no host to ask about its hooks. `auto` resolves to writing, because
    // the file this writes is `lessons.md` — the shared source an operator reads — and not a provider view.
    const verdict = coreFacade.lesson.durableViewVerdict(config.syncRulesFile, false);
    const { report, markdownPath } = await coreFacade.lesson.gardenAndPersistLessons(root, config, {
      writeDurableView: verdict.writes,
    });
    if (json) {
      emitJson({ report, markdownPath });
    } else {
      console.log(gardenText(report));
      if (markdownPath) {
        console.log(`synced rules → ${markdownPath}`);
      }
    }
    return;
  }

  if (cmd === "sync-rules") {
    const path = coreFacade.lesson.renderLessonsMarkdown(root, allLessons(root), config);
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
