import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { projectStateDir } from "../../platform/paths.ts";
import { compactBeforeHandler } from "../compact-before.ts";
import { promptSubmitHandler } from "../prompt-submit.ts";
import { runHandler } from "../run.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-prompt-compact-"));
}

function stdinOf(text: string) {
  return { readStdin: () => Promise.resolve(text) };
}

function obsRecords(root: string): Array<Record<string, unknown>> {
  const path = join(projectStateDir(root), "obs.jsonl");
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function cursorPromptSubmit(root: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook_event_name: "beforeSubmitPrompt",
    workspace_roots: [root],
    conversation_id: "conv-1",
    session_id: "sess-1",
    prompt: "please fix the bug",
    ...overrides,
  });
}

function claudePromptSubmit(root: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook_event_name: "UserPromptSubmit",
    cwd: root,
    session_id: "sess-1",
    prompt: "please fix the bug",
    ...overrides,
  });
}

function cursorCompactBefore(root: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook_event_name: "preCompact",
    workspace_roots: [root],
    conversation_id: "conv-1",
    session_id: "sess-1",
    ...overrides,
  });
}

function claudeCompactBefore(root: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook_event_name: "PreCompact",
    cwd: root,
    session_id: "sess-1",
    ...overrides,
  });
}

test("prompt.submit emits a provider-tagged obs record under Cursor", async () => {
  const root = tempRoot();
  try {
    await runHandler(promptSubmitHandler, stdinOf(cursorPromptSubmit(root)));
    const records = obsRecords(root);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.provider, "cursor");
    assert.equal(records[0]?.kind, "prompt.submit");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("prompt.submit emits a provider-tagged obs record under Claude", async () => {
  const root = tempRoot();
  try {
    await runHandler(promptSubmitHandler, stdinOf(claudePromptSubmit(root)));
    const records = obsRecords(root);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.provider, "claude");
    assert.equal(records[0]?.kind, "prompt.submit");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("prompt.submit returns an abstain decision", async () => {
  const root = tempRoot();
  try {
    const outcome = await runHandler(promptSubmitHandler, stdinOf(cursorPromptSubmit(root)));
    assert.equal(outcome.decision.kind, "abstain");
    assert.equal(outcome.rendered.exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compact.before emits a provider-tagged obs record under Cursor", async () => {
  const root = tempRoot();
  try {
    await runHandler(compactBeforeHandler, stdinOf(cursorCompactBefore(root)));
    const records = obsRecords(root);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.provider, "cursor");
    assert.equal(records[0]?.kind, "compact");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compact.before emits a provider-tagged obs record under Claude", async () => {
  const root = tempRoot();
  try {
    await runHandler(compactBeforeHandler, stdinOf(claudeCompactBefore(root)));
    const records = obsRecords(root);
    assert.equal(records.length, 1);
    assert.equal(records[0]?.provider, "claude");
    assert.equal(records[0]?.kind, "compact");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compact.before returns an abstain decision", async () => {
  const root = tempRoot();
  try {
    const outcome = await runHandler(compactBeforeHandler, stdinOf(cursorCompactBefore(root)));
    assert.equal(outcome.decision.kind, "abstain");
    assert.equal(outcome.rendered.exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compact.before records context_usage_percent when the provider supplies it", async () => {
  const root = tempRoot();
  try {
    await runHandler(compactBeforeHandler, stdinOf(cursorCompactBefore(root, { context_usage_percent: 92 })));
    const records = obsRecords(root);
    const attrs = records[0]?.attrs as Record<string, unknown>;
    assert.equal(attrs.context_usage_percent, 92);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("compact.before leaves context_usage_percent absent when the provider does not supply it", async () => {
  const root = tempRoot();
  try {
    await runHandler(compactBeforeHandler, stdinOf(cursorCompactBefore(root)));
    const records = obsRecords(root);
    const attrs = records[0]?.attrs as Record<string, unknown>;
    assert.equal(attrs.context_usage_percent, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unwritable state dir does not fail prompt.submit or compact.before", async () => {
  const root = tempRoot();
  try {
    mkdirSync(join(root, ".tlc", "harness"), { recursive: true });
    writeFileSync(join(root, ".tlc", "harness", "state"), "not a directory");
    const promptOutcome = await runHandler(promptSubmitHandler, stdinOf(cursorPromptSubmit(root)));
    const compactOutcome = await runHandler(compactBeforeHandler, stdinOf(cursorCompactBefore(root)));
    assert.equal(promptOutcome.decision.kind, "abstain");
    assert.equal(promptOutcome.rendered.exitCode, 0);
    assert.equal(compactOutcome.decision.kind, "abstain");
    assert.equal(compactOutcome.rendered.exitCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
