export type UntrustedSource = "web" | "mcp" | "shell";

export type UntrustedHit = {
  source: UntrustedSource;
  detail: string;
};

export type UntrustedDetectInput = {
  event: string;
  toolName?: string;
  command?: string;
  tools: readonly string[];
  commandPatterns: readonly string[];
};

export type UntrustedPolicyConfig = {
  enabled: boolean;
  extraTools: string[];
  extraCommandPatterns: string[];
};

// why: a declared list, never an inference over output. Guessing whether text came from outside the repo
// would make the rail fire on ordinary work and teach the operator to ignore it.
export const DEFAULT_UNTRUSTED_COMMAND_PATTERNS = [
  "gh pr view",
  "gh pr diff",
  "gh pr list",
  "gh issue view",
  "gh issue list",
  "gh api",
  "curl ",
  "wget ",
] as const;
