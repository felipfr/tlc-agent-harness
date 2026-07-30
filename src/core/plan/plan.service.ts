import type { Decision } from "../../contracts/decision.ts";
import { pathExcluded } from "../ship/ship.service.ts";
import type { PlanDeviation, PlanVerdict } from "./plan.types.ts";

export function planActive(declaredAt: string | undefined, windowMinutes: number, now = Date.now()): boolean {
  if (!declaredAt) {
    return false;
  }
  const at = Date.parse(declaredAt);
  if (Number.isNaN(at)) {
    return false;
  }
  return now - at < windowMinutes * 60 * 1000;
}

// why: the matcher is the one shipGate.runtimePathExcludes already accepts, so the operator learns a single
// pattern syntax rather than one per gate.
export function unplannedPaths(args: {
  changedFiles: readonly string[];
  planned: readonly string[];
  deviations: readonly PlanDeviation[];
}): string[] {
  const justified = args.deviations.map((deviation) => deviation.path);
  return args.changedFiles.filter((file) => {
    if (pathExcluded(file, [...args.planned])) {
      return false;
    }
    return !pathExcluded(file, justified);
  });
}

export function evaluatePlanGate(args: {
  enabled: boolean;
  declaredAt: string | undefined;
  windowMinutes: number;
  planned: readonly string[];
  deviations: readonly PlanDeviation[];
  changedFiles: readonly string[];
  now?: number;
}): Decision {
  const verdict = planVerdict(args);
  if (!verdict.active || verdict.unplanned.length === 0) {
    return { kind: "abstain" };
  }
  const listed = verdict.unplanned.slice(0, 10).join(", ");
  const more = verdict.unplanned.length > 10 ? ` (+${verdict.unplanned.length - 10} more)` : "";
  return {
    kind: "continue",
    text: [
      `BLOCKED: ${verdict.unplanned.length} changed file(s) are outside the declared plan: ${listed}${more}`,
      `TRIED: compared the working tree against HARNESS_PLAN (${args.planned.join(", ")}).`,
      "NEED: either revert what the plan did not call for, or justify each path with a reason —",
      "HARNESS_PLAN_DEVIATION: <path> — <why this file had to change>",
    ].join("\n"),
  };
}

export function planVerdict(args: {
  enabled: boolean;
  declaredAt: string | undefined;
  windowMinutes: number;
  planned: readonly string[];
  deviations: readonly PlanDeviation[];
  changedFiles: readonly string[];
  now?: number;
}): PlanVerdict {
  if (!args.enabled || args.planned.length === 0) {
    return { active: false, unplanned: [] };
  }
  if (!planActive(args.declaredAt, args.windowMinutes, args.now ?? Date.now())) {
    return { active: false, unplanned: [] };
  }
  return {
    active: true,
    unplanned: unplannedPaths({
      changedFiles: args.changedFiles,
      planned: args.planned,
      deviations: args.deviations,
    }),
  };
}
