import type { ProviderPolicyDefaults } from "../../contracts/index.ts";

export function claudePolicyDefaults(): ProviderPolicyDefaults {
  return {
    allowedModels: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
    blockedPatterns: [],
    minEffort: null,
  };
}
