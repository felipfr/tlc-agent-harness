import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { coreFacade } from "../src/core/index.ts";
import { readSignalEvents } from "../src/core/observability/observability.store.ts";
import { DEFAULT_OBS } from "../src/core/observability/observability.types.ts";
import { projectStateDir } from "../src/platform/paths.ts";

const root = process.env.TLC_PROJECT_DIR ?? process.cwd();
const cmd = (process.argv[2] ?? "live").toLowerCase();
const arg = process.argv[3];

if (cmd === "live") {
  const n = Number(arg ?? 40);
  const events = readSignalEvents(root, DEFAULT_OBS.signalPath, Number.isFinite(n) ? n : 40);
  const lines = events.map((e) => `${e.ts}\t${e.kind}\t${JSON.stringify(e.attrs).slice(0, 220)}`);
  console.log(lines.join("\n") || "(no signal events yet)");
  process.exit(0);
}

if (cmd === "events") {
  const n = Number(arg ?? 50);
  const events = readSignalEvents(root, DEFAULT_OBS.signalPath, Number.isFinite(n) ? n : 50);
  for (const e of events) {
    console.log(JSON.stringify(e));
  }
  process.exit(0);
}

if (cmd === "report") {
  let conversationId = arg;
  if (!conversationId) {
    const sessions = join(projectStateDir(root), "sessions");
    if (!existsSync(sessions)) {
      console.error("no sessions yet");
      process.exit(1);
    }
    const files = readdirSync(sessions)
      .filter((f) => f.endsWith(".json"))
      .sort();
    const last = files.at(-1);
    if (!last) {
      console.error("no sessions yet");
      process.exit(1);
    }
    conversationId = last.replace(/\.json$/, "");
  }
  const rollup = coreFacade.observability.getRollup(root, conversationId);
  if (!rollup) {
    console.error(`no rollup for session: ${conversationId}`);
    process.exit(1);
  }
  const markdown = coreFacade.observability.sessionReportMarkdown(rollup);
  const reportsDir = join(projectStateDir(root), "reports");
  mkdirSync(reportsDir, { recursive: true });
  const path = join(reportsDir, `${conversationId}.md`);
  writeFileSync(path, markdown);
  console.log(markdown);
  console.log(`\nWrote ${path}`);
  process.exit(0);
}

if (cmd === "rollup") {
  const conversationId = arg;
  if (!conversationId) {
    console.error("usage: tlc harness obs rollup <conversation_id>");
    process.exit(1);
  }
  console.log(JSON.stringify(coreFacade.observability.getRollup(root, conversationId), null, 2));
  process.exit(0);
}

if (cmd === "prune") {
  coreFacade.observability.pruneObs(root, DEFAULT_OBS.retentionDays);
  console.log("pruned old session rollups");
  process.exit(0);
}

console.error("usage: tlc harness obs <live|events|report|rollup|prune> [arg]");
process.exit(1);
