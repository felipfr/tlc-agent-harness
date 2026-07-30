import type { FailureCategory } from "../gate/gate.types.ts";
import type { OperatorMode } from "../policy/policy.types.ts";
import { suggestionFor } from "./turn.failure-signals.ts";

export type AutopilotPlan = {
  next_action: string;
  steps: string[];
};

export function resolveAutopilot(args: {
  category: FailureCategory;
  gate: string;
  mode: OperatorMode;
  loopCount: number;
  maxLoops: number;
  files?: string[];
}): AutopilotPlan {
  const filesHint =
    args.files && args.files.length > 0 ? `Focus files: ${args.files.slice(0, 8).join(", ")}.` : null;
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
          args.mode === "heads-down"
            ? "Focus mode: keep going until gates pass or you must escalate with BLOCKED/TRIED/NEED."
            : "Fix the reported issue with tool-backed evidence; do not invent success.",
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
