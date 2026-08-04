import type { SessionRollup } from "./observability.store.ts";
import type { ObsEvent } from "./observability.types.ts";

export type ProviderTotals = {
  provider: string;
  events: number;
  signals: number;
  denials: number;
  gates: { pass: number; fail: number };
  estimated_cost_usd: number;
};

function emptyTotals(provider: string): ProviderTotals {
  return { provider, events: 0, signals: 0, denials: 0, gates: { pass: 0, fail: 0 }, estimated_cost_usd: 0 };
}

export function groupByProvider(events: ObsEvent[]): Record<string, ProviderTotals> {
  const groups: Record<string, ProviderTotals> = {};
  for (const event of events) {
    const totals = groups[event.provider] ?? emptyTotals(event.provider);
    totals.events += 1;
    if (event.level === "signal") {
      totals.signals += 1;
    }
    if (event.kind === "policy.deny") {
      totals.denials += 1;
    }
    if (event.kind === "gate.outcome") {
      if (event.attrs.passed) {
        totals.gates.pass += 1;
      } else {
        totals.gates.fail += 1;
      }
    }
    if (typeof event.gen_ai?.cost_usd === "number") {
      totals.estimated_cost_usd += event.gen_ai.cost_usd;
    }
    groups[event.provider] = totals;
  }
  return groups;
}

/**
 * why: the count alone is not actionable — "seven interruptions" names no switch. The breakdown renders only when
 * there is something in it, so a session that was never interrupted reads exactly as it did before.
 *
 * invariant: this reports the decisions the harness made. It does not know the operator's answer, and it cannot
 * know whether a question it never asked would have helped — so it is a rate and an attribution, never a
 * precision or a recall. Naming it after a metric it cannot compute is the class of claim this project keeps
 * removing ([/decisions/ad-026.md](/decisions/ad-026.md)).
 */
function interruptionsByRule(rollup: SessionRollup): string {
  const entries = Object.entries(rollup.shell.byRule ?? {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    return "";
  }
  return entries.map(([rule, count]) => `| ↳ ${rule} | ${count} |`).join("\n");
}

/**
 * why: the question that decides something. A rail that never fired across a session is either working perfectly
 * or was never needed, and either way it is paying for injected prose on every turn. Naming it is what makes
 * deletion a decision instead of a feeling ([/decisions/ad-027.md](/decisions/ad-027.md)).
 *
 * invariant: the active list is a parameter. Core cannot see which rails a project enabled without reading policy,
 * and a report that guessed the list would accuse a rail that was never switched on.
 */
export function railsNeverFired(rollup: SessionRollup, activeRules: readonly string[]): string[] {
  const fired = new Set(Object.keys(rollup.railsByRule ?? {}));
  return activeRules.filter((rule) => !fired.has(rule)).sort();
}

function railActivity(rollup: SessionRollup, activeRules: readonly string[]): string {
  const fired = Object.entries(rollup.railsByRule ?? {}).sort((a, b) => b[1] - a[1]);
  const silent = railsNeverFired(rollup, activeRules);
  if (fired.length === 0 && silent.length === 0) {
    return "";
  }
  const rows = [
    "",
    "## Rails",
    "",
    "| Rule | Fired |",
    "|------|-------|",
    ...fired.map(([rule, count]) => `| ${rule} | ${count} |`),
    ...silent.map((rule) => `| ${rule} | 0 — enabled and never fired |`),
  ];
  if (rollup.injected_chars > 0) {
    rows.push(
      "",
      `Injected at session start: ${rollup.injected_chars} characters. That is the price of the rails above, paid on every turn.`,
    );
  }
  return rows.join("\n");
}

function gateDetail(rollup: SessionRollup): string {
  const entries = Object.entries(rollup.gatesByName ?? {}).sort((a, b) => b[1].fail - a[1].fail);
  if (entries.length === 0) {
    return "";
  }
  return entries.map(([gate, s]) => `| ↳ ${gate} | ${s.pass} / ${s.fail} |`).join("\n");
}

/**
 * why: the question an operator actually asks when a turn takes thirty minutes. The runs column is what makes the
 * multiplication visible: the gate cost is paid once per attempt, so six runs of a four-minute suite is the answer
 * and no amount of hook tuning would have changed it ([/decisions/ad-033.md](/decisions/ad-033.md)).
 */
function gateTimeSection(rollup: SessionRollup): string {
  const entries = Object.entries(rollup.gateTime ?? {}).sort((a, b) => b[1].totalMs - a[1].totalMs);
  if (entries.length === 0) {
    return "";
  }
  const seconds = (ms: number): string => (ms / 1000).toFixed(1);
  return [
    "",
    "## Gate time",
    "",
    "| Gate | Runs | Total s | Worst run s |",
    "|------|------|---------|-------------|",
    ...entries.map(([gate, t]) => `| ${gate} | ${t.runs} | ${seconds(t.totalMs)} | ${seconds(t.worstMs)} |`),
    "",
    "A gate's cost is paid once per attempt, so the total is the command's own time multiplied by how many times the",
    "agent had to retry. Lowering it means a faster command or fewer failures, not a faster harness.",
  ].join("\n");
}

export function sessionReportMarkdown(rollup: SessionRollup, activeRules: readonly string[] = []): string {
  const models = Object.entries(rollup.models)
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `| ${m} | ${n} |`)
    .join("\n");
  const tools = Object.entries(rollup.tools)
    .sort((a, b) => b[1].ok + b[1].fail - (a[1].ok + a[1].fail))
    .map(([t, s]) => `| ${t} | ${s.ok} | ${s.fail} | ${Math.round(s.ms)} |`)
    .join("\n");
  const subs = Object.entries(rollup.subagents)
    .map(([t, s]) => `| ${t} | ${s.count} | ${JSON.stringify(s.models)} |`)
    .join("\n");
  const costLabel = rollup.cost_incomplete
    ? `${rollup.estimated_cost_usd.toFixed(4)} (incomplete — some models lacked catalog rates)`
    : rollup.estimated_cost_usd.toFixed(4);

  return `# Harness session report

**Provider:** \`${rollup.provider}\`
**Session:** \`${rollup.session_id}\`
**Started:** ${rollup.started_at}
**Updated:** ${rollup.updated_at}

## Cost / tokens (estimated)

| Metric | Value |
|--------|-------|
| Estimated USD | ${costLabel} |
| Input tokens | ${rollup.input_tokens} |
| Output tokens | ${rollup.output_tokens} |
| Cost alert sent | ${rollup.cost_alert_sent} |

## Activity

| Metric | Value |
|--------|-------|
| Prompts | ${rollup.prompts} |
| Responses | ${rollup.responses} |
| Thoughts | ${rollup.thoughts} |
| Compactions | ${rollup.comped} |
| Policy denials | ${rollup.denials} |
| Gates pass/fail | ${rollup.gates.pass} / ${rollup.gates.fail} |
${gateDetail(rollup)}
| Shell allow/ask/deny | ${rollup.shell.allow} / ${rollup.shell.ask} / ${rollup.shell.deny} |
${interruptionsByRule(rollup)}

## Models

| Model | Events |
|-------|--------|
${models || "| — | 0 |"}

## Tools

| Tool | OK | Fail | ms |
|------|----|------|----|
${tools || "| — | 0 | 0 | 0 |"}

## Subagents

| Type | Count | Models |
|------|-------|--------|
${subs || "| — | 0 | {} |"}

## MCP tools

\`\`\`json
${JSON.stringify(rollup.mcp, null, 2)}
\`\`\`
${gateTimeSection(rollup)}
${railActivity(rollup, activeRules)}
`;
}
