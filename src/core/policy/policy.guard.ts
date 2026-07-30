import { relative } from "node:path";
import type { Decision } from "../../contracts/decision.ts";
import { flagsDir, projectConfigPath, projectStateDir } from "../../platform/paths.ts";
import { normalizeSeparators } from "../../platform/sanitize.ts";

const WRITE_TOOLS = new Set(["Edit", "Write", "Delete", "MultiEdit", "NotebookEdit"]);

export function isPolicySurface(projectDir: string, filePath: string): boolean {
  const target = normalizeSeparators(relative(projectDir, filePath) || filePath);
  const config = normalizeSeparators(relative(projectDir, projectConfigPath(projectDir)));
  const flags = normalizeSeparators(relative(projectDir, flagsDir(projectDir)));
  const state = normalizeSeparators(relative(projectDir, projectStateDir(projectDir)));
  return target === config || target.startsWith(`${flags}/`) || target.startsWith(`${state}/`);
}

export function guardPolicySurface(args: {
  projectDir: string;
  toolName: string | undefined;
  filePath: string | undefined;
}): Decision {
  if (!args.toolName || !WRITE_TOOLS.has(args.toolName) || !args.filePath) {
    return { kind: "allow" };
  }
  if (!isPolicySurface(args.projectDir, args.filePath)) {
    return { kind: "allow" };
  }
  return {
    kind: "deny",
    reason: [
      "Harness policy and state are not agent-writable — a gate an agent can switch off is not a gate.",
      "Change policy through the CLI instead: tlc harness grind | pause | resume | mode | init.",
      "If a gate is wrong, say so and let the operator decide; do not edit around it.",
    ].join(" "),
    userNote: `Blocked an agent write to ${args.filePath}.`,
  };
}
