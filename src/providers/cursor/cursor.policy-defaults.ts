import type { ProviderPolicyDefaults } from "../../contracts/index.ts";

export function cursorPolicyDefaults(): ProviderPolicyDefaults {
  return {
    allowedModels: [
      "composer-2.5",
      "cursor-grok-4.5-high",
      "glm-5.2-high",
      "kimi-k2.7-code",
      "gpt-5.3-codex-high",
    ],
    blockedPatterns: ["-fast(?:$|[^a-z0-9])", "/fast(?:$|[^a-z0-9])", "composer-2\\.5-fast"],
    minEffort: null,
    untrustedTools: ["Fetch", "WebSearch"],
  };
}
