import type { EffortLevel } from "./effort.ts";

export type ProviderPolicyDefaults = {
  allowedModels: string[];
  blockedPatterns: string[];
  minEffort: EffortLevel | null;
  /** Tool names whose results carry content from outside the repository. */
  untrustedTools: string[];
};
