export const GATE_SCHEMA = "harness.gate.v1" as const;

export type GateFinding = {
  id?: string;
  summary: string;
  detail?: string;
};

export type LastGateArtifact = {
  schema: typeof GATE_SCHEMA;
  gate: string;
  exitCode: number;
  passed: boolean;
  command: string[];
  files: string[];
  durationMs: number;
  ts: string;
  outputTail: string;
  findings: GateFinding[];
};

export type AppendFilesMode = "auto" | "always" | "never";

export type FailureCategory =
  | "agent-quality"
  | "stagnation"
  | "verification"
  | "ship-evidence"
  | "policy"
  | "config"
  | "infra"
  | "budget";

export type GateGap = {
  id: string;
  gate: string;
  category: FailureCategory;
  summary: string;
  detail?: string;
};

export type LockBody = {
  provider: string;
  session: string;
  pid: number;
  acquired_at: string;
};
