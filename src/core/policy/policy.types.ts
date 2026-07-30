export type CommentMode = "declared" | "strict";

import type { EffortLevel } from "../../contracts/effort.ts";

export type OperatorMode = "paired" | "solo" | "heads-down";

export type ProviderScoped<T> = T[] | Record<string, T[]>;

export function forProvider<T>(scoped: ProviderScoped<T> | undefined, provider: string): T[] | null {
  if (scoped === undefined) {
    return null;
  }
  if (Array.isArray(scoped)) {
    return scoped;
  }
  return scoped[provider] ?? null;
}

export type LessonsPolicyConfig = {
  enabled: boolean;
  maxInjectSession: number;
  maxInjectRetry: number;
  maxCharsSession: number;
  maxCharsRetry: number;
  promoteHitCount: number;
  decayLambda: number;
  projectBoost: number;
  syncRulesFile: boolean;
  gardenOnSessionEnd: boolean;
};

export type Policy = {
  version: 1;
  mode: OperatorMode;
  projectName?: string;
  codePaths: string[];
  format: {
    enabled: boolean;
    command: string[];
  };
  grind: {
    enabled: boolean;
    maxLoops: number;
    lintCommand: string[] | null;
    testCommand: string[] | null;
  };
  shipGate: {
    enabled: boolean;
    runtimePathPrefixes: string[];
    runtimePathExcludes: string[];
    evidenceDir: string | null;
    evidenceMaxAgeHours: number;
    emptyDiffAntiShip: boolean;
    claimWindowMinutes: number;
  };
  subagents: {
    enforceAllowlist: boolean;
    requireModel: boolean;
    allowedModels: ProviderScoped<string>;
    blockedPatterns: ProviderScoped<string>;
    minEffort: EffortLevel | null;
    blockParentFast: boolean;
    blockMode: "deny" | "ask";
    readOnlyTypes: string[];
  };
  docs: {
    /** Null means the gate does not exist for this project. */
    command: string[] | null;
    severity: "warn" | "deny";
  };
  comments: {
    enabled: boolean;
    onViolation: "followup" | "off";
    mode: CommentMode;
  };
  obs: {
    globalSpool: boolean;
  };
  untrustedContent: {
    enabled: boolean;
    extraTools: string[];
    extraCommandPatterns: string[];
  };
  shell: {
    catastrophicAsk: boolean;
    stallDetection: boolean;
    stallRepeatThreshold: number;
  };
  intelligence: {
    gapFeedback: boolean;
    failureClassification: boolean;
    progressiveHandoff: boolean;
    progressiveContext: boolean;
    autopilot: boolean;
    idleTurnGate: boolean;
    budgetContinue: boolean;
    budgetContinueAfterLoops: number;
    lessons: LessonsPolicyConfig;
  };
  mcpPrime: string[];
  bootstrapExtra: string[];
};

export type PartialPolicy = Partial<Policy> & {
  format?: Partial<Policy["format"]>;
  grind?: Partial<Policy["grind"]>;
  shipGate?: Partial<Policy["shipGate"]>;
  subagents?: Partial<Policy["subagents"]>;
  docs?: Partial<Policy["docs"]>;
  comments?: Partial<Policy["comments"]>;
  obs?: Partial<Policy["obs"]>;
  untrustedContent?: Partial<Policy["untrustedContent"]>;
  shell?: Partial<Policy["shell"]>;
  intelligence?: Partial<Policy["intelligence"]> & {
    lessons?: Partial<LessonsPolicyConfig>;
  };
};
