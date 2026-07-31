import type { Decision } from "../../contracts/decision.ts";
import { isPolicySurface } from "../floor/floor.paths.ts";

export { isPolicySurface };

const WRITE_TOOLS = new Set(["Edit", "Write", "Delete", "MultiEdit", "NotebookEdit"]);

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
