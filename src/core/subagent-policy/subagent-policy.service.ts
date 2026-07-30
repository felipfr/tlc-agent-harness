import type { Decision } from "../../contracts/decision.ts";
import type { EffortLevel } from "../../contracts/effort.ts";
import { compareEffort, isEffortLevel } from "../../contracts/effort.ts";
import { forProvider, type ProviderScoped } from "../policy/policy.types.ts";
import {
  candidateModelBlocked,
  isModelAllowlisted,
  shouldDenyParentFast,
} from "./subagent-policy.parent-model.ts";

export type EvaluateSubagentSpawnArgs = {
  provider: string;
  sessionKey: string;
  projectDir: string;
  model: string;
  modelParams?: unknown;
  effort?: string;
  allowedModels: ProviderScoped<string>;
  blockedPatterns: ProviderScoped<string>;
  minEffort: EffortLevel | null;
  requireModel: boolean;
  enforceAllowlist: boolean;
  blockParentFast: boolean;
  blockMode?: "deny" | "ask";
};

export function evaluateSubagentSpawn(args: EvaluateSubagentSpawnArgs): Decision {
  const patterns = forProvider(args.blockedPatterns, args.provider) ?? [];
  const block = (reason: string, userNote: string): Decision =>
    args.blockMode === "ask" ? { kind: "ask", reason, userNote } : { kind: "deny", reason, userNote };

  const blockedBy = candidateModelBlocked(args.model, patterns, args.modelParams);
  if (blockedBy) {
    return block(
      `Do not use *-fast models. Pattern hit: ${blockedBy}.`,
      `Blocked subagent model "${args.model}" (matches ${blockedBy}).`,
    );
  }

  if (args.requireModel && !args.model.trim()) {
    return block(
      "Set model explicitly on every Task spawn. Do not omit model.",
      "Subagent spawned without an explicit model.",
    );
  }

  const allowed = forProvider(args.allowedModels, args.provider);
  if (args.enforceAllowlist && args.model && allowed !== null && !isModelAllowlisted(args.model, allowed)) {
    return block(
      `Use one of: ${allowed.join(", ")}.`,
      `Subagent model "${args.model}" is not on the allowlist.`,
    );
  }

  if (
    args.minEffort &&
    args.effort !== undefined &&
    isEffortLevel(args.effort) &&
    compareEffort(args.effort, args.minEffort) < 0
  ) {
    return block(
      `Subagent effort "${args.effort}" is below the required minimum "${args.minEffort}".`,
      `Raise the subagent effort to at least "${args.minEffort}" and retry.`,
    );
  }

  if (
    shouldDenyParentFast({
      enabled: args.blockParentFast,
      projectDir: args.projectDir,
      sessionKey: args.sessionKey,
      patterns,
    })
  ) {
    return block(
      "Parent Fast mode is forbidden for Task/subagent spawns. Turn Fast off on the parent model and retry.",
      "Blocked subagent spawn: parent conversation is in Fast mode.",
    );
  }

  return { kind: "allow" };
}

export {
  candidateModelBlocked,
  isModelAllowlisted,
  modelMatchesBlocked,
  readParentModelState,
  shouldDenyParentFast,
  upsertParentModelState,
} from "./subagent-policy.parent-model.ts";
