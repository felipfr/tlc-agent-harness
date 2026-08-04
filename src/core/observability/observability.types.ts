import type { HarnessEventKind } from "../../contracts/harness-event.ts";

export type ObsLevel = "signal" | "debug";

export type GenAiOutcome = "success" | "error" | "denied" | "timeout" | "aborted";

export type ObsKind =
  | "session.start"
  | "session.end"
  | "generation.start"
  | "generation.end"
  | "tool.start"
  | "tool.end"
  | "tool.fail"
  | "shell.start"
  | "shell.end"
  | "mcp.start"
  | "mcp.end"
  | "subagent.start"
  | "subagent.end"
  | "file.edit"
  | "file.read"
  | "prompt.submit"
  | "agent.response"
  | "agent.thought"
  | "compact"
  | "gate.outcome"
  | "cost.turn"
  | "cost.session_alert"
  | "ship.claim"
  | "policy.deny";

export type CostPool = "provider_native" | "other" | "auto" | "unknown";

export type CostSource = "provider" | "litellm" | "override" | "billed" | "missing";

export type ObsEvent = {
  schema: "harness.observability.v1";
  provider: string;
  kind: ObsKind;
  level: ObsLevel;
  ts: string;
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  session_id?: string;
  model?: string;
  attrs: Record<string, unknown>;
  gen_ai?: {
    operation_name?: string;
    provider_name?: string;
    request_model?: string;
    input_tokens?: number;
    output_tokens?: number;
    reasoning_tokens?: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
    cost_usd?: number | null;
    cost_source?: CostSource;
    cost_pool?: CostPool;
    duration_ms?: number;
    outcome?: GenAiOutcome;
  };
};

export type AuditRecord = {
  ts: string;
  event: string;
  payload: unknown;
};

export type ObservabilityConfig = {
  enabled: boolean;
  signalPath: "obs.jsonl";
  debugPath: "debug.jsonl";
  debugEnabled: boolean;
  includePayloads: boolean;
  maxAttrChars: number;
  sessionCostAlertUsd: number | null;
  retentionDays: number;
  maxSignalEvents: number;
  globalSpool: boolean;
};

export const DEFAULT_OBS: ObservabilityConfig = {
  enabled: true,
  signalPath: "obs.jsonl",
  debugPath: "debug.jsonl",
  debugEnabled: false,
  includePayloads: false,
  maxAttrChars: 500,
  sessionCostAlertUsd: 5,
  retentionDays: 14,
  maxSignalEvents: 50_000,
  globalSpool: false,
};

export const SIGNAL_KINDS = new Set<ObsKind>([
  "session.start",
  "session.end",
  "generation.end",
  "tool.fail",
  "subagent.start",
  "subagent.end",
  "prompt.submit",
  "compact",
  "gate.outcome",
  "cost.turn",
  "cost.session_alert",
  "ship.claim",
  "policy.deny",
]);

export const LIVE_ALLOWLIST = new Set<ObsKind>([
  "session.start",
  "session.end",
  "generation.end",
  "tool.fail",
  "shell.end",
  "subagent.start",
  "subagent.end",
  "gate.outcome",
  "cost.turn",
  "cost.session_alert",
  "ship.claim",
  "policy.deny",
  "compact",
  "prompt.submit",
]);

export function resolveObsLevel(
  kind: ObsKind,
  attrs: Record<string, unknown> = {},
  forceDebug = false,
): ObsLevel {
  if (forceDebug) {
    return "debug";
  }
  // hazard: this branch used to key on `shell.end` alone, and a command that was denied or asked about never
  // reaches an "after" event — so the only permission it could ever grade was `allow`, and `rollup.shell.ask`
  // could not have moved even once the attribute was written. The decision is made at `shell.start`; that is the
  // only phase where a non-allow permission exists ([/decisions/ad-026.md](/decisions/ad-026.md)).
  if (kind === "shell.end" || kind === "shell.start") {
    const permission = String(attrs.permission ?? "allow");
    return permission === "allow" ? "debug" : "signal";
  }
  if (kind === "mcp.end") {
    const outcome = String(attrs.outcome ?? attrs.status ?? "success");
    return outcome === "error" || outcome === "fail" || outcome === "denied" ? "signal" : "debug";
  }
  return SIGNAL_KINDS.has(kind) ? "signal" : "debug";
}

export const EVENT_KIND_TO_OBS_KIND: Record<HarnessEventKind, ObsKind> = {
  "session.start": "session.start",
  "session.end": "session.end",
  "prompt.submit": "prompt.submit",
  "tool.before": "tool.start",
  "tool.after": "tool.end",
  "tool.failure": "tool.fail",
  "shell.before": "shell.start",
  "shell.after": "shell.end",
  "mcp.before": "mcp.start",
  "mcp.after": "mcp.end",
  "read.before": "file.read",
  "edit.after": "file.edit",
  "subagent.start": "subagent.start",
  "subagent.stop": "subagent.end",
  stop: "generation.end",
  "compact.before": "compact",
  "response.after": "agent.response",
  "thought.after": "agent.thought",
};

const SECRET_KEY = /(token|secret|password|api[_-]?key|authorization|credential|private[_-]?key)/i;
const SECRET_VALUE = /\b(ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g;

export function redactDeep(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(SECRET_VALUE, "[REDACTED]");
  }
  if (Array.isArray(value)) {
    return value.map(redactDeep);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? "[REDACTED]" : redactDeep(nested);
    }
    return out;
  }
  return value;
}
