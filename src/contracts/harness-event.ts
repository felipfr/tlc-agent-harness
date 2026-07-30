import type { EffortLevel } from "./effort.ts";

export type HarnessEventKind =
  | "session.start"
  | "session.end"
  | "prompt.submit"
  | "tool.before"
  | "tool.after"
  | "tool.failure"
  | "shell.before"
  | "shell.after"
  | "mcp.before"
  | "mcp.after"
  | "read.before"
  | "edit.after"
  | "subagent.start"
  | "subagent.stop"
  | "stop"
  | "compact.before"
  | "response.after"
  | "thought.after";

export const HARNESS_EVENT_KINDS: readonly HarnessEventKind[] = [
  "session.start",
  "session.end",
  "prompt.submit",
  "tool.before",
  "tool.after",
  "tool.failure",
  "shell.before",
  "shell.after",
  "mcp.before",
  "mcp.after",
  "read.before",
  "edit.after",
  "subagent.start",
  "subagent.stop",
  "stop",
  "compact.before",
  "response.after",
  "thought.after",
];

export type HarnessUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
};

export type HarnessEvent = {
  provider: string;
  event: HarnessEventKind;
  sessionKey: string;
  projectDir: string;
  // hazard: the `spawn*` pair describes the child of a spawn; the unprefixed fields describe the
  // running agent. Conflating them clobbers sticky parent state.
  model?: string;
  spawnModel?: string;
  effort?: EffortLevel;
  text?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  command?: string;
  filePath?: string;
  subagentType?: string;
  spawnSubagentType?: string;
  status?: "completed" | "aborted" | "error";
  loopCount?: number;
  /** Provider's own permission posture, when it exposes one. Absent means unknown, not permissive. */
  permissionMode?: string;
  contextUsagePercent?: number;
  transcriptPath?: string;
  usage?: HarnessUsage;
  /** Adapter-only escape hatch — core must not read this. */
  raw: Record<string, unknown>;
};
