import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { HarnessEvent } from "../../../contracts/harness-event.ts";
import { projectStateDir } from "../../../platform/paths.ts";
import { recordAudit, recordFromEvent, recordObs } from "../observability.service.ts";
import { getRollup } from "../observability.store.ts";
import { DEFAULT_OBS } from "../observability.types.ts";

function readAuditLines(root: string): Array<{ ts: string; event: string; payload: unknown }> {
  return readFileSync(join(projectStateDir(root), "audit.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-obs-service-"));
}

function baseEvent(overrides: Partial<HarnessEvent> = {}): HarnessEvent {
  return {
    provider: "provider-a",
    event: "tool.before",
    sessionKey: "provider-a-session-1",
    projectDir: "/tmp/project",
    raw: {},
    ...overrides,
  };
}

test("recordObs returns null when observability is disabled", () => {
  const root = tempRoot();
  try {
    const result = recordObs(
      root,
      { ...DEFAULT_OBS, enabled: false },
      {
        provider: "provider-a",
        kind: "policy.deny",
      },
    );
    assert.equal(result, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every recorded event carries the provider that produced it", () => {
  const root = tempRoot();
  try {
    const eventA = recordObs(root, DEFAULT_OBS, { provider: "provider-a", kind: "policy.deny" });
    const eventB = recordObs(root, DEFAULT_OBS, { provider: "provider-b", kind: "policy.deny" });
    assert.equal(eventA?.provider, "provider-a");
    assert.equal(eventB?.provider, "provider-b");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("debug-level events are dropped by default", () => {
  const root = tempRoot();
  try {
    const result = recordObs(root, DEFAULT_OBS, { provider: "provider-a", kind: "tool.start" });
    assert.equal(result, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("debug-level events are kept once debugEnabled is turned on", () => {
  const root = tempRoot();
  try {
    const result = recordObs(
      root,
      { ...DEFAULT_OBS, debugEnabled: true },
      {
        provider: "provider-a",
        kind: "tool.start",
      },
    );
    assert.equal(result?.level, "debug");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("forceDebug routes an otherwise-signal kind to the debug channel despite debug being off", () => {
  const root = tempRoot();
  try {
    const result = recordObs(root, DEFAULT_OBS, {
      provider: "provider-a",
      kind: "policy.deny",
      forceDebug: true,
    });
    assert.equal(result?.level, "debug");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("gen_ai.cost_pool of provider_native passes through unchanged", () => {
  const root = tempRoot();
  try {
    const result = recordObs(root, DEFAULT_OBS, {
      provider: "provider-b",
      kind: "cost.turn",
      gen_ai: { cost_pool: "provider_native", cost_usd: 0.02 },
    });
    assert.equal(result?.gen_ai?.cost_pool, "provider_native");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a session's accumulated cost is tracked in its rollup", () => {
  const root = tempRoot();
  try {
    recordObs(root, DEFAULT_OBS, {
      provider: "provider-a",
      kind: "cost.turn",
      sessionKey: "session-x",
      gen_ai: { input_tokens: 10, output_tokens: 5, cost_usd: 0.03 },
    });
    const rollup = getRollup(root, "session-x");
    assert.equal(rollup?.estimated_cost_usd, 0.03);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recordObs degrades to null without throwing when the state dir is unwritable", () => {
  const root = tempRoot();
  try {
    mkdirSync(join(root, ".tlc", "harness"), { recursive: true });
    writeFileSync(join(root, ".tlc", "harness", "state"), "not a directory");
    assert.doesNotThrow(() => {
      const result = recordObs(root, DEFAULT_OBS, { provider: "provider-a", kind: "policy.deny" });
      assert.equal(result, null);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recordFromEvent maps a harness event kind to its obs kind", () => {
  const root = tempRoot();
  try {
    const result = recordFromEvent(root, DEFAULT_OBS, baseEvent({ event: "tool.failure" }));
    assert.equal(result?.kind, "tool.fail");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recordFromEvent never reads the event's raw escape hatch", () => {
  const root = tempRoot();
  try {
    const event = baseEvent({ raw: { secret_vendor_field: "leak" } });
    const result = recordFromEvent(root, DEFAULT_OBS, event);
    assert.equal(JSON.stringify(result).includes("secret_vendor_field"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recordAudit appends a redacted record to audit.jsonl regardless of obs level", () => {
  const root = tempRoot();
  try {
    recordAudit(root, "shell.after", { command: "ls", api_key: "sk-1234567890123456789012345" });
    const lines = readAuditLines(root);
    assert.equal(lines.length, 1);
    assert.equal(lines[0]?.event, "shell.after");
    assert.deepEqual(lines[0]?.payload, { command: "ls", api_key: "[REDACTED]" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recordAudit is never gated by DEFAULT_OBS's debugEnabled: false", () => {
  const root = tempRoot();
  try {
    recordAudit(root, "tool.after", { tool_name: "Read" });
    assert.equal(readAuditLines(root).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recordAudit accumulates one line per call", () => {
  const root = tempRoot();
  try {
    recordAudit(root, "shell.after", { command: "ls" });
    recordAudit(root, "tool.after", { tool_name: "Write" });
    assert.equal(readAuditLines(root).length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recordAudit degrades to a no-op without throwing when the state dir is unwritable", () => {
  const root = tempRoot();
  try {
    mkdirSync(join(root, ".tlc", "harness"), { recursive: true });
    writeFileSync(join(root, ".tlc", "harness", "state"), "not a directory");
    assert.doesNotThrow(() => recordAudit(root, "shell.after", { command: "ls" }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
