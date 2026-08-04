import type { FailureCategory } from "../gate/gate.types.ts";
import type { OperatorMode } from "../policy/policy.types.ts";
import { suggestionFor } from "./turn.failure-signals.ts";

export type AutopilotPlan = {
  next_action: string;
  steps: string[];
};

// hazard: this line used to read `Focus files: <changed files>` under a category whose plan says "fix each
// item explicitly". The changed files come from the diff, so under a failure they had nothing to do with, the
// plan pointed an agent at innocent code — measured naming a file no test imports while the gate output named
// the three real ones. Only evidence may read as an instruction; the diff has to say what it is.
function fileLine(failing: string[] | undefined, changed: string[] | undefined): string | null {
  if (failing && failing.length > 0) {
    return `Failing files (named by the gate output): ${failing.slice(0, 8).join(", ")}.`;
  }
  if (changed && changed.length > 0) {
    return `Files the gate ran (from the diff, not necessarily the cause): ${changed.slice(0, 8).join(", ")}.`;
  }
  return null;
}

/**
 * invariant: these render only from the default branch below, which is reached after a gate has already failed —
 * late in the work by construction. That makes this the one place where the deadline for a question is a fact
 * rather than a guess, so every posture states the same settle-and-state form and none invites a question about
 * ambiguity. Asking at this point is measurably worse than deciding
 * ([/decisions/ad-026.md](/decisions/ad-026.md)).
 *
 * `paired` keeps its check-in, because that one is about an action it is *about to take*, not about ambiguity
 * it should have raised earlier.
 */
const POSTURE_STEP: Record<OperatorMode, string> = {
  paired:
    "Fix the reported issue with tool-backed evidence, showing your reasoning, and check in before any sizable non-destructive move. The work is already under way, so settle any remaining ambiguity yourself and state the assumption.",
  solo: "Fix the reported issue with tool-backed evidence; do not invent success. The work is already under way, so settle remaining ambiguity by taking the most reasonable reading and stating the assumption; escalate only an irreversible action or a real dead-end.",
  focus:
    "Keep going until the gates pass. Settle ambiguity yourself and state the assumption; escalate only for an irreversible action or a real dead-end, with BLOCKED / TRIED / NEED.",
};

export function resolveAutopilot(args: {
  category: FailureCategory;
  gate: string;
  mode: OperatorMode;
  loopCount: number;
  maxLoops: number;
  /** Files the gate output itself named — evidence of where the failure is. */
  failingFiles?: string[];
  /** Files the gate ran against, from the diff. Context, never a culprit. */
  changedFiles?: string[];
}): AutopilotPlan {
  const filesHint = fileLine(args.failingFiles, args.changedFiles);
  const base = suggestionFor(args.category, args.gate);

  switch (args.category) {
    case "verification":
      return {
        next_action: base,
        steps: [
          `Do not claim done. Gate ${args.gate} is still failing (loop ${args.loopCount + 1}/${args.maxLoops}).`,
          "Read the PREVIOUS_GAPS list and fix each item explicitly.",
          "Do not add suppressions, delete tests, or weaken the gate.",
          filesHint ?? "Re-run only against the changed files the gate used.",
          "After edits, continue — the stop hook will re-check.",
        ].filter(Boolean) as string[],
      };
    case "stagnation":
      return {
        next_action: base,
        steps: [
          "STOP repeating the same edit/command pattern.",
          "Diagnose root cause with a different tool or smaller repro.",
          "If still blocked after one new approach, emit BLOCKED / TRIED / NEED to the owner.",
        ],
      };
    case "ship-evidence":
      return {
        next_action: base,
        steps: [
          "Do not claim shipped/done yet.",
          args.gate === "empty-diff"
            ? "Either implement the missing work (produce a real diff) or explain why zero changes is correct."
            : "Produce production evidence and cite 90-verdict.txt before claiming done.",
          "Then continue — ship gate will re-check on the next stop.",
        ],
      };
    case "budget":
      return {
        next_action: base,
        steps: [
          "Do not summarize or wrap up.",
          "Prefer tool calls that advance unfinished handoff work.",
          "Address PREVIOUS_GAPS if present before anything else.",
        ],
      };
    case "policy":
      return {
        next_action: base,
        steps: [
          "Change approach to comply with policy (model allowlist, shell stall, explore read-only).",
          "Do not retry the denied action with the same arguments.",
        ],
      };
    case "config":
      return {
        next_action: base,
        steps: ["Run harness doctor.", "Fix .tlc/harness/config.json commands/paths.", "Retry the task."],
      };
    case "infra":
      return {
        next_action: base,
        steps: ["Verify lint/test CLIs are installed and on PATH.", "Retry the gate after tooling works."],
      };
    default:
      return {
        next_action: base,
        steps: [
          // why: the step states the active posture's interruption threshold, which is what posture governs.
          // It says nothing about gates — those do not vary by posture.
          POSTURE_STEP[args.mode],
          filesHint,
        ].filter(Boolean) as string[],
      };
  }
}

export function formatAutopilotBlock(plan: AutopilotPlan): string {
  const lines = plan.steps.map((step, i) => `${i + 1}. ${step}`);
  return [
    "AUTOPILOT (runtime-decided — execute in order; do not invent a different plan):",
    ...lines,
    "",
    `NEXT_ACTION: ${plan.next_action}`,
  ].join("\n");
}
