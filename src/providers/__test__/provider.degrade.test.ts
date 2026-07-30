import assert from "node:assert/strict";
import { test } from "node:test";
import type { Decision, HarnessEvent, ProviderCapabilities } from "../../contracts/index.ts";
import { degrade } from "../provider.degrade.ts";

const FULL_CAPS: ProviderCapabilities = {
  enforcesHooks: true,
  askSupportedOn: ["tool.before", "shell.before", "mcp.before"],
  sessionEnv: true,
  nativeLoopCounter: true,
  dedicatedShellEvent: true,
  toolInputRewrite: true,
  toolOutputRewrite: true,
  contextAtToolBefore: true,
  contextAtToolAfter: true,
  usageInPayload: true,
  effortSignal: true,
  thoughtEvent: true,
};

function caps(overrides: Partial<ProviderCapabilities> = {}): ProviderCapabilities {
  return { ...FULL_CAPS, ...overrides };
}

function eventAt(kind: HarnessEvent["event"]): HarnessEvent {
  return {
    provider: "fixture",
    event: kind,
    sessionKey: "fixture-default",
    projectDir: "/tmp",
    raw: {},
  };
}

function eventInMode(mode: string | undefined): HarnessEvent {
  const event = eventAt("shell.before");
  return mode === undefined ? event : { ...event, permissionMode: mode };
}

for (const mode of ["bypassPermissions", "dontAsk"]) {
  test(`ask degrades to deny under permission mode ${mode}`, () => {
    const decision: Decision = { kind: "ask", reason: "confirm deletion", userNote: "note" };
    const result = degrade(decision, eventInMode(mode), caps());
    assert.equal(result.kind, "deny");
    assert.match(result.kind === "deny" ? result.reason : "", /No operator is answering prompts/);
    assert.equal(result.kind === "deny" ? result.userNote : undefined, "note");
  });
}

for (const mode of ["default", "plan", "acceptEdits", "auto"]) {
  test(`ask survives under permission mode ${mode}, where the operator still answers`, () => {
    const decision: Decision = { kind: "ask", reason: "confirm deletion" };
    assert.equal(degrade(decision, eventInMode(mode), caps()).kind, "ask");
  });
}

test("ask survives when the provider reports no permission mode at all", () => {
  const decision: Decision = { kind: "ask", reason: "confirm deletion" };
  assert.equal(degrade(decision, eventInMode(undefined), caps()).kind, "ask");
});

test("the unsupported-event denial wins over the permission-mode denial", () => {
  const decision: Decision = { kind: "ask", reason: "confirm deletion" };
  const result = degrade(decision, eventInMode("bypassPermissions"), caps({ askSupportedOn: [] }));
  assert.match(result.kind === "deny" ? result.reason : "", /Escalation unavailable/);
});

test("ask at tool.before degrades to deny when tool.before is absent from askSupportedOn", () => {
  const decision: Decision = { kind: "ask", reason: "confirm deletion" };
  const result = degrade(
    decision,
    eventAt("tool.before"),
    caps({ askSupportedOn: ["shell.before", "mcp.before"] }),
  );
  assert.equal(result.kind, "deny");
  assert.ok(result.kind === "deny" && result.reason.startsWith("Escalation unavailable on this provider — "));
  assert.ok(result.kind === "deny" && result.reason.includes("confirm deletion"));
});

test("ask at shell.before passes through unchanged when shell.before is in askSupportedOn", () => {
  const decision: Decision = { kind: "ask", reason: "catastrophic command" };
  const result = degrade(decision, eventAt("shell.before"), caps({ askSupportedOn: ["shell.before"] }));
  assert.equal(result, decision);
});

test("ask at shell.before degrades to deny when shell.before is absent from askSupportedOn", () => {
  const decision: Decision = { kind: "ask", reason: "catastrophic command" };
  const result = degrade(decision, eventAt("shell.before"), caps({ askSupportedOn: ["mcp.before"] }));
  assert.equal(result.kind, "deny");
});

test("ask at mcp.before degrades to deny when mcp.before is absent from askSupportedOn", () => {
  const decision: Decision = { kind: "ask", reason: "unapproved MCP tool" };
  const result = degrade(decision, eventAt("mcp.before"), caps({ askSupportedOn: ["shell.before"] }));
  assert.equal(result.kind, "deny");
});

test("ask at mcp.after degrades to deny when mcp.after is absent from askSupportedOn — Cursor's real asymmetry", () => {
  const decision: Decision = { kind: "ask", reason: "unexpected MCP result" };
  const result = degrade(decision, eventAt("mcp.after"), caps({ askSupportedOn: ["mcp.before"] }));
  assert.equal(result.kind, "deny");
});

test("context carrying env drops env when sessionEnv is false, keeps text", () => {
  const decision: Decision = { kind: "context", text: "bootstrap", env: { HARNESS_ACTIVE: "1" } };
  const result = degrade(decision, eventAt("session.start"), caps({ sessionEnv: false }));
  assert.equal(result.kind, "context");
  assert.ok(result.kind === "context" && result.env === undefined);
  assert.ok(result.kind === "context" && result.text === "bootstrap");
});

test("context carrying env passes through unchanged when sessionEnv is true", () => {
  const decision: Decision = { kind: "context", text: "bootstrap", env: { HARNESS_ACTIVE: "1" } };
  const result = degrade(decision, eventAt("session.start"), caps({ sessionEnv: true }));
  assert.equal(result, decision);
});

test("rewriteInput degrades to ask carrying the proposed input when toolInputRewrite is false", () => {
  const decision: Decision = { kind: "rewriteInput", input: { command: "ls -la" }, reason: "sandboxed path" };
  const result = degrade(decision, eventAt("tool.before"), caps({ toolInputRewrite: false }));
  assert.equal(result.kind, "ask");
  assert.ok(result.kind === "ask" && result.reason.includes(JSON.stringify({ command: "ls -la" })));
});

test("rewriteInput passes through unchanged when toolInputRewrite is true", () => {
  const decision: Decision = { kind: "rewriteInput", input: { command: "ls -la" }, reason: "sandboxed path" };
  const result = degrade(decision, eventAt("tool.before"), caps({ toolInputRewrite: true }));
  assert.equal(result, decision);
});

test("continue degrades to context with the advisory prefix when enforcesHooks is false", () => {
  const decision: Decision = { kind: "continue", text: "keep going" };
  const result = degrade(decision, eventAt("stop"), caps({ enforcesHooks: false }));
  assert.equal(result.kind, "context");
  assert.ok(result.kind === "context" && result.text.startsWith("ADVISORY — this provider cannot enforce: "));
  assert.ok(result.kind === "context" && result.text.includes("keep going"));
});

test("deny degrades to context with the advisory prefix when enforcesHooks is false", () => {
  const decision: Decision = { kind: "deny", reason: "blocked pattern" };
  const result = degrade(decision, eventAt("tool.before"), caps({ enforcesHooks: false }));
  assert.equal(result.kind, "context");
  assert.ok(result.kind === "context" && result.text.includes("blocked pattern"));
});

test("ask degrades to advisory context (not deny) when enforcesHooks is false, even if askSupportedOn excludes the kind", () => {
  const decision: Decision = { kind: "ask", reason: "confirm" };
  const result = degrade(
    decision,
    eventAt("tool.before"),
    caps({ enforcesHooks: false, askSupportedOn: [] }),
  );
  assert.equal(result.kind, "context");
  assert.ok(result.kind === "context" && result.text.startsWith("ADVISORY"));
});

test("rewriteInput degrades to advisory context mentioning the proposed input when enforcesHooks is false", () => {
  const decision: Decision = { kind: "rewriteInput", input: { command: "ls" }, reason: "scope it" };
  const result = degrade(decision, eventAt("tool.before"), caps({ enforcesHooks: false }));
  assert.equal(result.kind, "context");
  assert.ok(result.kind === "context" && result.text.includes(JSON.stringify({ command: "ls" })));
});

test("context text over the configured budget is truncated with a trailing marker", () => {
  const decision: Decision = { kind: "context", text: "x".repeat(100) };
  const result = degrade(decision, eventAt("session.start"), caps(), { contextBudgetChars: 60 });
  assert.equal(result.kind, "context");
  assert.ok(result.kind === "context" && result.text.length <= 60);
  assert.ok(result.kind === "context" && result.text.includes("truncated"));
});

test("context text within budget is left unchanged", () => {
  const decision: Decision = { kind: "context", text: "short" };
  const result = degrade(decision, eventAt("session.start"), caps(), { contextBudgetChars: 200 });
  assert.equal(result, decision);
});

test("allow decision needing no degradation is returned by identity", () => {
  const decision: Decision = { kind: "allow" };
  const result = degrade(
    decision,
    eventAt("tool.before"),
    caps({ askSupportedOn: [], enforcesHooks: false }),
  );
  assert.equal(result, decision);
});

test("abstain decision needing no degradation is returned by identity", () => {
  const decision: Decision = { kind: "abstain" };
  const result = degrade(decision, eventAt("stop"), caps({ enforcesHooks: false }));
  assert.equal(result, decision);
});
