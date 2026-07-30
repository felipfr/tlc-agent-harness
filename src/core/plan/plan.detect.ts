import type { PlanDeclaration, PlanDeviation } from "./plan.types.ts";

const PLAN_LINE = /(?:^|\n)\s*HARNESS_PLAN:\s*(.+?)\s*(?=\n|$)/;
const DEVIATION_LINE = /(?:^|\n)\s*HARNESS_PLAN_DEVIATION:\s*(.+?)\s*(?=\n|$)/g;
const REASON_SEPARATOR = /\s+(?:—|--|-)\s+/;

function splitPaths(body: string): string[] {
  return body
    .split(/[,\s]+/)
    .map((path) => path.trim())
    .filter((path) => path.length > 0);
}

// why: an empty declaration is malformed, not "nothing is planned". Treating it as an empty plan would make
// every subsequent file unplanned and block the turn on a typo.
export function detectPlan(text: string): PlanDeclaration | null {
  const match = PLAN_LINE.exec(text);
  const body = match?.[1]?.trim();
  if (!body) {
    return null;
  }
  const paths = splitPaths(body);
  if (paths.length === 0) {
    return null;
  }
  return { paths, snippet: `HARNESS_PLAN: ${body}`.slice(0, 280) };
}

export function detectDeviations(text: string): PlanDeviation[] {
  const found: PlanDeviation[] = [];
  for (const match of text.matchAll(DEVIATION_LINE)) {
    const body = match[1]?.trim();
    if (!body) {
      continue;
    }
    const [rawPath, ...rest] = body.split(REASON_SEPARATOR);
    const path = rawPath?.trim();
    const reason = rest.join(" ").trim();
    // why: a path with no stated reason is not a justification. Accepting it would turn the gate into a
    // formality the agent can satisfy by naming the file it already touched.
    if (!path || reason.length === 0) {
      continue;
    }
    found.push({ path, reason });
  }
  return found;
}
