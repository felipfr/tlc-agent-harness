import { join } from "node:path";
import type { Decision, HarnessEvent, ProviderCapabilities, Rendered } from "../contracts/index.ts";
import { coreFacade, type Policy } from "../core/index.ts";
import { appendRecord } from "../platform/fs-jsonl.ts";
import { projectStateDir } from "../platform/paths.ts";
import { readStdinText } from "../platform/process.ts";
import {
  degrade,
  type ProviderPort,
  providers as providerRegistry,
  resolveFromRegistry,
} from "../providers/index.ts";
import { effectiveBlockedPatterns, obsConfigFor, sessionIdFromKey } from "./support.ts";

export type HandlerContext = {
  policy: Policy;
  capabilities: ProviderCapabilities;
  provider: ProviderPort;
  now: Date;
};

export type Handler = (event: HarnessEvent, ctx: HandlerContext) => Decision | Promise<Decision>;

export type RunIo = {
  readStdin?: () => Promise<string>;
  now?: () => Date;
};

export type RunOutcome = {
  event: HarnessEvent | null;
  decision: Decision;
  rendered: Rendered;
};

// invariant: this caps the whole injected context. Lessons carry their own, smaller budget
// (lessons.maxCharsSession) — reusing that here truncated the operator posture and handoff.
export const CONTEXT_BUDGET_CHARS = 6000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// why: ObsKind is a closed union with no adapter-boundary member — these fire before a provider/session is known, so they bypass core's typed observability rather than widening that union from outside core.
function recordAdapterEvent(root: string, kind: string, attrs: Record<string, unknown>): void {
  try {
    appendRecord(join(projectStateDir(root), "obs.jsonl"), {
      schema: "harness.observability.v1",
      provider: "unknown",
      kind,
      level: "signal",
      ts: new Date().toISOString(),
      attrs,
    });
  } catch {}
}

/**
 * hazard: `policy.deny` fed `rollup.denials` and the report's "Policy denials" line, and had no producer — so a
 * harness whose whole purpose is refusing things reported zero refusals
 * ([/decisions/ad-027.md](/decisions/ad-027.md)).
 *
 * why: recorded here, after `degrade`, because this is the one place every entrypoint's decision passes through
 * and the only place that sees the decision the provider will actually render. A per-entrypoint recording would
 * miss whichever entrypoint is added next, and would record a decision that degrade could still change.
 *
 * invariant: shell decisions are recorded by `tool-before` as `shell.start`, with their own permission attribute.
 * Recording them here as well would double-count every interruption.
 */
function recordRefusal(event: HarnessEvent, policy: Policy, decision: Decision): void {
  if (decision.kind !== "deny" && decision.kind !== "ask") {
    return;
  }
  if (event.event === "shell.before") {
    return;
  }
  coreFacade.observability.recordObs(event.projectDir, obsConfigFor(policy), {
    provider: event.provider,
    kind: "policy.deny",
    sessionKey: event.sessionKey,
    attrs: {
      event: event.event,
      tool_name: event.toolName,
      permission: decision.kind,
      // why: unattributed rather than guessed. A refusal an operator cannot trace to a rule is noise.
      rule: decision.rule ?? "none",
    },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function runHandler(handler: Handler, io: RunIo = {}): Promise<RunOutcome> {
  const readStdin = io.readStdin ?? readStdinText;
  const now = io.now ? io.now() : new Date();
  const abstainRendered: Rendered = { stdout: null, exitCode: 0 };

  const text = await readStdin();
  const trimmed = text.trim();
  if (!trimmed) {
    recordAdapterEvent(process.cwd(), "adapter.unrecognized", { reason: "empty-stdin" });
    return { event: null, decision: { kind: "abstain" }, rendered: abstainRendered };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    recordAdapterEvent(process.cwd(), "adapter.unrecognized", { reason: "invalid-json" });
    return { event: null, decision: { kind: "abstain" }, rendered: abstainRendered };
  }

  const resolved = resolveFromRegistry(parsed, providerRegistry);
  if (!resolved.provider) {
    recordAdapterEvent(process.cwd(), "adapter.unrecognized", { reason: "no-provider-match" });
    return { event: null, decision: { kind: "abstain" }, rendered: abstainRendered };
  }
  if (resolved.ambiguous) {
    recordAdapterEvent(process.cwd(), "adapter.ambiguous", { matched: resolved.matchedNames });
  }

  const provider = resolved.provider;
  const event = provider.toEvent(asRecord(parsed));
  if (!event) {
    recordAdapterEvent(process.cwd(), "adapter.unrecognized", {
      reason: "unrecognized-event",
      provider: provider.name,
    });
    return { event: null, decision: { kind: "abstain" }, rendered: abstainRendered };
  }

  const capabilities = provider.capabilities();

  try {
    const policy = coreFacade.policy.loadPolicy(event.projectDir);
    if (event.model) {
      coreFacade.subagentPolicy.upsertParentModelState(
        event.projectDir,
        event.sessionKey,
        { model: event.model },
        effectiveBlockedPatterns(policy.subagents.blockedPatterns, provider),
      );
    }
    coreFacade.presence.heartbeat(event.projectDir, {
      provider: event.provider,
      session: sessionIdFromKey(event),
      file: event.filePath,
      now,
    });
    const context: HandlerContext = { policy, capabilities, provider, now };
    const decision = await handler(event, context);
    const degraded = degrade(decision, event, capabilities, {
      contextBudgetChars: CONTEXT_BUDGET_CHARS,
    });
    recordRefusal(event, policy, degraded);
    const rendered = provider.render(degraded, event);
    return { event, decision: degraded, rendered };
  } catch (error) {
    recordAdapterEvent(event.projectDir, "adapter.error", {
      provider: event.provider,
      event: event.event,
      message: errorMessage(error),
    });
    const abstain: Decision = { kind: "abstain" };
    return { event, decision: abstain, rendered: provider.render(abstain, event) };
  }
}

export async function main(handler: Handler): Promise<void> {
  const outcome = await runHandler(handler);
  if (outcome.rendered.stdout !== null) {
    const text = outcome.rendered.stdout;
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
  }
  process.exit(outcome.rendered.exitCode);
}
