import type { OperatorMode, Policy } from "./policy.types.ts";

const BASE = [
  "Harness: drive tasks to verified completion without babysitting the owner.",
  "Evidence or stop: no invented numbers, versions, or PASS claims. Cite paths, command output, or evidence files.",
  "Ask the owner only for: irreversible or destructive actions, a real dead-end after searching, or costly ambiguity you cannot resolve.",
  "Otherwise assume the sensible default, proceed, and state the assumption in one line.",
  "Before calling done: build, tests and lint must pass; no deleted tests; diff size matches the ask; the result matches the full request.",
  "If blocked, use exactly: BLOCKED / TRIED / NEED — one tight block, no preamble.",
];

const BY_MODE: Record<OperatorMode, string> = {
  paired: "Mode paired: explain reasoning more; check in before sizable non-destructive moves.",
  "heads-down":
    "Mode focus: maximum autonomy — do not ask for confirmation on reversible work. Grind gates run on stop instead, so verify yourself rather than asking; ship claims need evidence when configured.",
  solo: "Mode solo: work autonomously; premature ship claims are challenged when the ship gate is enabled.",
};

export function operatorBootstrapLines(policy: Policy, stateDir: string): string[] {
  const lines = [...BASE, `Hold state on disk at ${stateDir}/handoff.json between turns and sessions.`];
  lines.push(BY_MODE[policy.mode]);

  if (policy.shipGate.enabled) {
    lines.push(
      "Ship protocol: the ship gate reacts only to an explicit line `HARNESS_SHIP_CLAIM: <summary>` — free-English done or shipped is ignored. After that claim, cite recent PASS evidence under the configured evidenceDir before stopping.",
    );
  }
  if (policy.comments.enabled) {
    lines.push(
      policy.comments.mode === "strict"
        ? "Comments: do not add any. If one is warranted, say so in your reply and let the owner write it."
        : "Comments: an added comment must declare why:, hazard: or invariant:. Narrating what the code does is blocked.",
    );
  }
  if (policy.mcpPrime.length > 0) {
    lines.push("", "MCP prime (before host grep or glob across the workspace):");
    for (const [index, step] of policy.mcpPrime.entries()) {
      lines.push(`${index + 1}. ${step}`);
    }
  }
  lines.push(...policy.bootstrapExtra);
  return lines;
}
