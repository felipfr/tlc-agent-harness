import type { EffortLevel } from "./effort.ts";

export type ProviderPolicyDefaults = {
  allowedModels: string[];
  blockedPatterns: string[];
  minEffort: EffortLevel | null;
};
