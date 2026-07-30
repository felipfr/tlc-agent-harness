import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { projectStateDir } from "../../platform/paths.ts";
import { runHandler } from "../run.ts";
import { toolAfterHandler } from "../tool-after.ts";
import { toolFailureHandler } from "../tool-failure.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-tool-after-"));
}

function stdinOf(text: string) {
  return { readStdin: () => Promise.resolve(text) };
}

function readJsonl(path: string): Array<Record<string, unknown>> {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function obsRecords(root: string): Array<Record<string, unknown>> {
  return readJsonl(join(projectStateDir(root), "obs.jsonl"));
}

function allRecords(root: string): Array<Record<string, unknown>> {
  return [...obsRecords(root), ...readJsonl(join(projectStateDir(root), "debug.jsonl"))];
}

function auditRecords(root: string): Array<Record<string, unknown>> {
  return readJsonl(join(projectStateDir(root), "audit.jsonl"));
}

function cursorToolAfter(root: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook_event_name: "postToolUse",
    workspace_roots: [root],
    conversation_id: "conv-1",
    session_id: "sess-1",
    tool_name: "Grep",
    ...overrides,
  });
}

function claudeToolAfter(root: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook_event_name: "PostToolUse",
    cwd: root,
    session_id: "sess-1",
    tool_name: "Grep",
    ...overrides,
  });
}

function cursorShellAfter(root: string, command: string): string {
  return JSON.stringify({
    hook_event_name: "afterShellExecution",
    workspace_roots: [root],
    conversation_id: "conv-1",
    session_id: "sess-1",
    command,
    cwd: root,
    sandbox: true,
  });
}

function claudeShellAfter(root: string, command: string): string {
  return JSON.stringify({
    hook_event_name: "PostToolUse",
    cwd: root,
    session_id: "sess-1",
    tool_name: "Bash",
    tool_input: { command },
    sandbox: false,
  });
}

function cursorToolFailure(root: string): string {
  return JSON.stringify({
    hook_event_name: "postToolUseFailure",
    workspace_roots: [root],
    conversation_id: "conv-1",
    session_id: "sess-1",
    tool_name: "Read",
  });
}

test("tool.after emits a provider-tagged obs record", async () => {
  const root = tempRoot();
  try {
    await runHandler(toolAfterHandler, stdinOf(cursorToolAfter(root)));
    const records = allRecords(root);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.provider, "cursor");
    assert.equal(records[0]?.kind, "tool.end");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tool.after returns an abstain decision", async () => {
  const root = tempRoot();
  try {
    const outcome = await runHandler(toolAfterHandler, stdinOf(cursorToolAfter(root)));
    assert.equal(outcome.decision.kind, "abstain");
    assert.equal(outcome.rendered.exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tool.failure emits a provider-tagged obs record with kind tool.fail", async () => {
  const root = tempRoot();
  try {
    await runHandler(toolFailureHandler, stdinOf(cursorToolFailure(root)));
    const records = obsRecords(root);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.provider, "cursor");
    assert.equal(records[0]?.kind, "tool.fail");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tool.failure returns an abstain decision", async () => {
  const root = tempRoot();
  try {
    const outcome = await runHandler(toolFailureHandler, stdinOf(cursorToolFailure(root)));
    assert.equal(outcome.decision.kind, "abstain");
    assert.equal(outcome.rendered.exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shell.after is audited with command, cwd, and sandbox under Cursor", async () => {
  const root = tempRoot();
  try {
    await runHandler(toolAfterHandler, stdinOf(cursorShellAfter(root, "ls -la")));
    const records = allRecords(root);
    assert.equal(records.length, 1);
    const attrs = records[0]?.attrs as Record<string, unknown>;
    assert.equal(attrs.command, "ls -la");
    assert.equal(attrs.cwd, root);
    assert.equal(attrs.sandbox, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shell.after is audited with command, cwd, and sandbox under Claude", async () => {
  const root = tempRoot();
  try {
    await runHandler(toolAfterHandler, stdinOf(claudeShellAfter(root, "npm test")));
    const records = allRecords(root);
    assert.equal(records.length, 1);
    const attrs = records[0]?.attrs as Record<string, unknown>;
    assert.equal(attrs.command, "npm test");
    assert.equal(attrs.cwd, root);
    assert.equal(attrs.sandbox, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("edit.after emits a file.edit obs record", async () => {
  const root = tempRoot();
  try {
    await runHandler(
      toolAfterHandler,
      stdinOf(
        cursorToolAfter(root, {
          hook_event_name: "afterFileEdit",
          tool_name: undefined,
          file_path: "src/x.ts",
        }),
      ),
    );
    const records = allRecords(root);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.kind, "file.edit");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mcp.after emits an mcp.end obs record", async () => {
  const root = tempRoot();
  try {
    await runHandler(
      toolAfterHandler,
      stdinOf(cursorToolAfter(root, { hook_event_name: "afterMCPExecution", tool_name: "mcp__thing__call" })),
    );
    const records = allRecords(root);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.kind, "mcp.end");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unwritable state dir does not fail tool.after", async () => {
  const root = tempRoot();
  try {
    mkdirSync(join(root, ".tlc", "harness"), { recursive: true });
    writeFileSync(join(root, ".tlc", "harness", "state"), "not a directory");
    const outcome = await runHandler(toolAfterHandler, stdinOf(cursorToolAfter(root)));
    assert.equal(outcome.decision.kind, "abstain");
    assert.equal(outcome.rendered.exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unwritable state dir does not fail tool.failure", async () => {
  const root = tempRoot();
  try {
    mkdirSync(join(root, ".tlc", "harness"), { recursive: true });
    writeFileSync(join(root, ".tlc", "harness", "state"), "not a directory");
    const outcome = await runHandler(toolFailureHandler, stdinOf(cursorToolFailure(root)));
    assert.equal(outcome.decision.kind, "abstain");
    assert.equal(outcome.rendered.exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cost estimation resolves usage and cost from a Claude transcript at tool.after", async () => {
  const root = tempRoot();
  const priceHome = mkdtempSync(join(tmpdir(), "tlc-price-home-"));
  const originalHome = process.env.TLC_HOME;
  try {
    process.env.TLC_HOME = priceHome;
    writeFileSync(
      join(priceHome, "model-prices.json"),
      JSON.stringify({
        "claude-sonnet-5": {
          promptPer1M: 3,
          completionPer1M: 15,
          pool: "provider_native",
          billing: "metered",
        },
      }),
    );
    const transcriptPath = join(root, "transcript.jsonl");
    writeFileSync(
      transcriptPath,
      `${JSON.stringify({ message: { usage: { input_tokens: 1000, output_tokens: 500 } } })}\n`,
    );
    const outcome = await runHandler(
      toolAfterHandler,
      stdinOf(
        claudeToolAfter(root, {
          model: "claude-sonnet-5",
          transcript_path: transcriptPath,
        }),
      ),
    );
    assert.equal(outcome.decision.kind, "abstain");
    const records = allRecords(root);
    assert.equal(records.length, 1);
    const genAi = records[0]?.gen_ai as Record<string, unknown>;
    assert.equal(genAi.input_tokens, 1000);
    assert.equal(genAi.output_tokens, 500);
    assert.equal(genAi.cost_usd, (1000 / 1_000_000) * 3 + (500 / 1_000_000) * 15);
  } finally {
    if (originalHome === undefined) {
      delete process.env.TLC_HOME;
    } else {
      process.env.TLC_HOME = originalHome;
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(priceHome, { recursive: true, force: true });
  }
});

test("shell.after writes an audit.jsonl record with the raw payload", async () => {
  const root = tempRoot();
  try {
    await runHandler(toolAfterHandler, stdinOf(cursorShellAfter(root, "ls -la")));
    const records = auditRecords(root);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.event, "shell.after");
    const payload = records[0]?.payload as Record<string, unknown>;
    assert.equal(payload.command, "ls -la");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tool.after writes an audit.jsonl record", async () => {
  const root = tempRoot();
  try {
    await runHandler(toolAfterHandler, stdinOf(cursorToolAfter(root)));
    const records = auditRecords(root);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.event, "tool.after");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tool.failure writes an audit.jsonl record", async () => {
  const root = tempRoot();
  try {
    await runHandler(toolFailureHandler, stdinOf(cursorToolFailure(root)));
    const records = auditRecords(root);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.event, "tool.failure");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cost estimation is skipped when usage arrives in the payload (Cursor)", async () => {
  const root = tempRoot();
  try {
    const outcome = await runHandler(
      toolAfterHandler,
      stdinOf(cursorToolAfter(root, { transcript_path: join(root, "does-not-matter.jsonl") })),
    );
    assert.equal(outcome.decision.kind, "abstain");
    const records = allRecords(root);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.gen_ai, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
