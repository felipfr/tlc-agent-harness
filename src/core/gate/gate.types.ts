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
  /**
   * The machine that wrote the lock. A pid only means something on the host that issued it, so liveness is
   * consulted only when this matches. A body without it — written by an older build — falls back to the age
   * rule, which is the honest answer when liveness cannot be established.
   */
  host?: string;
};
