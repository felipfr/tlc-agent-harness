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

export function sessionReportMarkdown(rollup: SessionRollup): string {
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
| Shell allow/ask/deny | ${rollup.shell.allow} / ${rollup.shell.ask} / ${rollup.shell.deny} |

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
`;
}
