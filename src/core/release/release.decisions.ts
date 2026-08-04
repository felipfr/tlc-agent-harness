import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * why: the substance of a changelog already exists in this repository as thirty decision records, each carrying why,
 * the trade-offs and what was refused. What was missing is the mapping from "I updated" to "these landed". Reading
 * the records is that mapping, and it needs no second index to maintain
 * ([/decisions/ad-031.md](/decisions/ad-031.md)).
 *
 * invariant: a `migration` note is what marks a decision as needing operator action. Anything finer would be the
 * harness guessing whether a given config is affected, and `doctor` already answers that precisely — the note says
 * what to do, the doctor says whether it applies to you.
 */
export type DecisionSummary = {
  id: string;
  title: string;
  /** Present only when the decision requires the operator to change something. */
  migration?: string;
};

function frontmatterField(text: string, field: string): string | undefined {
  // why: line-scoped, matching how `check-docs-bundle` reads the same files. The values here are single-line
  // quoted strings by convention, and the bundle check is what enforces that.
  const match = new RegExp(`^${field}:\\s*"?(.+?)"?\\s*$`, "m").exec(text);
  const value = match?.[1]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

export function decisionsDir(repoRoot: string): string {
  return join(repoRoot, "docs", "decisions");
}

/** why: an absent docs directory is an empty list, not an error. A linked checkout may not carry docs at all. */
export function readDecision(repoRoot: string, file: string): DecisionSummary | null {
  const path = join(decisionsDir(repoRoot), file);
  if (!existsSync(path)) {
    return null;
  }
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const title = frontmatterField(text, "title");
  if (title === undefined) {
    return null;
  }
  const id = file.replace(/\.md$/, "").toUpperCase();
  const migration = frontmatterField(text, "migration");
  return migration === undefined ? { id, title } : { id, title, migration };
}

export function readDecisions(repoRoot: string, files: string[]): DecisionSummary[] {
  return files
    .filter((file) => /^ad-\d+\.md$/.test(file))
    .map((file) => readDecision(repoRoot, file))
    .filter((decision): decision is DecisionSummary => decision !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function allDecisionFiles(repoRoot: string): string[] {
  const dir = decisionsDir(repoRoot);
  if (!existsSync(dir)) {
    return [];
  }
  try {
    return readdirSync(dir).filter((file) => /^ad-\d+\.md$/.test(file));
  } catch {
    return [];
  }
}

export function needsAction(decisions: readonly DecisionSummary[]): DecisionSummary[] {
  return decisions.filter((decision) => decision.migration !== undefined);
}

/**
 * why: the shape the capability digest established — what is new, what it costs you, and never repeated. The
 * needs-action half is separated and put first, because a note an operator scrolls past is a note that did not
 * arrive.
 */
export function formatDecisionDigest(decisions: readonly DecisionSummary[]): string {
  if (decisions.length === 0) {
    return "";
  }
  const action = needsAction(decisions);
  const lines: string[] = [`Decisions that landed (${decisions.length}):`];
  if (action.length > 0) {
    lines.push("", `NEEDS YOUR ACTION (${action.length}):`);
    for (const decision of action) {
      // why: the title already carries its own id, so prefixing would print it twice.
      lines.push(`  ${decision.title}`, `    → ${decision.migration}`);
    }
  }
  const rest = decisions.filter((decision) => decision.migration === undefined);
  if (rest.length > 0) {
    lines.push("", "No action needed:");
    for (const decision of rest) {
      lines.push(`  ${decision.title}`);
    }
  }
  lines.push("", "Full reasoning: docs/decisions/index.md");
  return lines.join("\n");
}
