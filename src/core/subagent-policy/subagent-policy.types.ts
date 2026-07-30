export type ModelParam = { id?: string; value?: string };

export type ParentModelSnapshot = {
  model: string;
  model_params: ModelParam[] | null;
  fast: boolean;
  updated_at: string;
};

export type SubagentDenialReason =
  | "blocked_pattern"
  | "missing_model"
  | "not_allowlisted"
  | "min_effort"
  | "parent_fast";

export type SubagentDecisionDetail =
  | { reason: "blocked_pattern"; pattern: string }
  | { reason: "missing_model" }
  | { reason: "not_allowlisted"; allowed: string[] }
  | { reason: "min_effort"; observed: string | null; required: string }
  | { reason: "parent_fast" };
