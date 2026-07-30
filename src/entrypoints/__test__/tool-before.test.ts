import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { coreFacade } from "../../core/index.ts";
import { projectConfigPath } from "../../platform/paths.ts";
import { runHandler } from "../run.ts";
import { toolBeforeHandler } from "../tool-before.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-tool-before-"));
}

function stdinOf(text: string) {
  return { readStdin: () => Promise.resolve(text) };
}

function writeProjectPolicy(root: string, patch: Record<string, unknown>): void {
  const path = projectConfigPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(patch, null, 2), "utf8");
}

function cursorShell(root: string, command: string): string {
  return JSON.stringify({
    hook_event_name: "beforeShellExecution",
    workspace_roots: [root],
    conversation_id: "conv-1",
    session_id: "sess-1",
    command,
  });
}

function claudeShell(root: string, command: string): string {
  return JSON.stringify({
    hook_event_name: "PreToolUse",
    cwd: root,
    session_id: "sess-1",
    tool_name: "Bash",
    tool_input: { command },
  });
}

function cursorMcp(root: string): string {
  return JSON.stringify({
    hook_event_name: "beforeMCPExecution",
    workspace_roots: [root],
    conversation_id: "conv-1",
    session_id: "sess-1",
    tool_name: "mcp__whatever__call",
  });
}

function cursorRead(root: string, filePath: string): string {
  return JSON.stringify({
    hook_event_name: "beforeReadFile",
    workspace_roots: [root],
    conversation_id: "conv-1",
    session_id: "sess-1",
    file_path: filePath,
  });
}

function cursorTool(root: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook_event_name: "preToolUse",
    workspace_roots: [root],
    conversation_id: "conv-1",
    session_id: "sess-1",
    tool_name: "Grep",
    ...overrides,
  });
}

function claudeTool(root: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook_event_name: "PreToolUse",
    cwd: root,
    session_id: "sess-1",
    tool_name: "Grep",
    ...overrides,
  });
}

// invariant: the floor decides before the tunable shell guardrail, so `rm -rf /` is denied outright
// rather than escalated. An ask can be answered yes, and under bypassPermissions it reaches nobody.
for (const [label, build] of [
  ["Claude", claudeShell],
  ["Cursor", cursorShell],
] as const) {
  test(`destruction outside the project is denied by the floor under ${label}`, async () => {
    const root = tempRoot();
    try {
      const outcome = await runHandler(toolBeforeHandler, stdinOf(build(root, "rm -rf /")));
      assert.equal(outcome.decision.kind, "deny");
      assert.match(
        outcome.decision.kind === "deny" ? outcome.decision.reason : "",
        /rule=outside-project-destruction/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("a catastrophic command the floor does not cover still reaches the tunable ask", async () => {
  const root = tempRoot();
  try {
    const outcome = await runHandler(
      toolBeforeHandler,
      stdinOf(cursorShell(root, "diskutil partitionDisk disk2")),
    );
    assert.equal(outcome.decision.kind, "ask");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a normal shell command is allowed", async () => {
  const root = tempRoot();
  try {
    const outcome = await runHandler(toolBeforeHandler, stdinOf(cursorShell(root, "ls -la")));
    assert.equal(outcome.decision.kind, "allow");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a shell command repeated past the stall threshold is denied", async () => {
  const root = tempRoot();
  try {
    writeProjectPolicy(root, { shell: { stallDetection: true, stallRepeatThreshold: 2 } });
    await runHandler(toolBeforeHandler, stdinOf(cursorShell(root, "npm test")));
    const outcome = await runHandler(toolBeforeHandler, stdinOf(cursorShell(root, "npm test")));
    assert.equal(outcome.decision.kind, "deny");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mcp.before always allows", async () => {
  const root = tempRoot();
  try {
    const outcome = await runHandler(toolBeforeHandler, stdinOf(cursorMcp(root)));
    assert.equal(outcome.decision.kind, "allow");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("read.before denies a credential path and allows an ordinary one", async () => {
  const root = tempRoot();
  try {
    const secret = await runHandler(toolBeforeHandler, stdinOf(cursorRead(root, "~/.ssh/id_rsa")));
    assert.equal(secret.decision.kind, "deny");
    assert.match(secret.decision.kind === "deny" ? secret.decision.reason : "", /rule=secret-access/);

    const ordinary = await runHandler(toolBeforeHandler, stdinOf(cursorRead(root, "src/index.ts")));
    assert.equal(ordinary.decision.kind, "allow");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a blocked Task model is denied under Cursor", async () => {
  const root = tempRoot();
  try {
    const outcome = await runHandler(
      toolBeforeHandler,
      stdinOf(cursorTool(root, { tool_name: "Task", tool_input: { model: "worker-fast" } })),
    );
    assert.equal(outcome.decision.kind, "deny");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a blocked Task model is denied under Claude with the identical reason text as Cursor", async () => {
  const cursorRoot = tempRoot();
  const claudeRoot = tempRoot();
  try {
    const cursorOutcome = await runHandler(
      toolBeforeHandler,
      stdinOf(cursorTool(cursorRoot, { tool_name: "Task", tool_input: { model: "worker-fast" } })),
    );
    const claudeOutcome = await runHandler(
      toolBeforeHandler,
      stdinOf(claudeTool(claudeRoot, { tool_name: "Task", tool_input: { model: "worker-fast" } })),
    );
    assert.equal(cursorOutcome.decision.kind, "deny");
    assert.equal(claudeOutcome.decision.kind, "deny");
    if (cursorOutcome.decision.kind === "deny" && claudeOutcome.decision.kind === "deny") {
      assert.equal(cursorOutcome.decision.reason, claudeOutcome.decision.reason);
    }
  } finally {
    rmSync(cursorRoot, { recursive: true, force: true });
    rmSync(claudeRoot, { recursive: true, force: true });
  }
});

test("a Task spawn with no model is denied when requireModel is enabled", async () => {
  const root = tempRoot();
  try {
    writeProjectPolicy(root, { subagents: { requireModel: true } });
    const outcome = await runHandler(
      toolBeforeHandler,
      stdinOf(cursorTool(root, { tool_name: "Task", tool_input: {} })),
    );
    assert.equal(outcome.decision.kind, "deny");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a Task spawn with a non-allowlisted model is denied when enforceAllowlist is enabled", async () => {
  const root = tempRoot();
  try {
    writeProjectPolicy(root, {
      subagents: { enforceAllowlist: true, allowedModels: ["only-this-one"] },
    });
    const outcome = await runHandler(
      toolBeforeHandler,
      stdinOf(cursorTool(root, { tool_name: "Task", tool_input: { model: "something-else" } })),
    );
    assert.equal(outcome.decision.kind, "deny");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a Task spawn's minEffort violation is denied under Claude", async () => {
  const root = tempRoot();
  try {
    writeProjectPolicy(root, { subagents: { minEffort: "high" } });
    const outcome = await runHandler(
      toolBeforeHandler,
      stdinOf(
        claudeTool(root, {
          tool_name: "Task",
          tool_input: { model: "claude-sonnet-5" },
          effort: { level: "low" },
        }),
      ),
    );
    assert.equal(outcome.decision.kind, "deny");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a Task spawn's minEffort check is skipped under Cursor, which reports no effort", async () => {
  const root = tempRoot();
  try {
    writeProjectPolicy(root, { subagents: { minEffort: "high" } });
    const outcome = await runHandler(
      toolBeforeHandler,
      stdinOf(cursorTool(root, { tool_name: "Task", tool_input: { model: "composer-2.5" } })),
    );
    assert.equal(outcome.decision.kind, "allow");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a Task spawn is denied when the sticky parent state is Fast", async () => {
  const root = tempRoot();
  try {
    writeProjectPolicy(root, { subagents: { blockParentFast: true } });
    await runHandler(
      toolBeforeHandler,
      stdinOf(cursorTool(root, { tool_name: "Grep", model: "composer-2.5-fast" })),
    );
    const outcome = await runHandler(
      toolBeforeHandler,
      stdinOf(cursorTool(root, { tool_name: "Task", tool_input: { model: "composer-2.5" } })),
    );
    assert.equal(outcome.decision.kind, "deny");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a Task spawn on an unblocked, allowlisted model is allowed under Cursor", async () => {
  const root = tempRoot();
  try {
    const outcome = await runHandler(
      toolBeforeHandler,
      stdinOf(cursorTool(root, { tool_name: "Task", tool_input: { model: "composer-2.5" } })),
    );
    assert.equal(outcome.decision.kind, "allow");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a Task spawn on an unblocked, allowlisted model is allowed under Claude", async () => {
  const root = tempRoot();
  try {
    const outcome = await runHandler(
      toolBeforeHandler,
      stdinOf(claudeTool(root, { tool_name: "Task", tool_input: { model: "claude-sonnet-5" } })),
    );
    assert.equal(outcome.decision.kind, "allow");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an Edit to a file held by a live foreign presence yields ask under Claude", async () => {
  const root = tempRoot();
  try {
    coreFacade.presence.register(root, {
      provider: "cursor",
      session: "other-session",
      pid: 1,
      branch: "main",
    });
    coreFacade.presence.heartbeat(root, {
      provider: "cursor",
      session: "other-session",
      file: "src/shared.ts",
    });
    const outcome = await runHandler(
      toolBeforeHandler,
      stdinOf(claudeTool(root, { tool_name: "Edit", tool_input: { file_path: "src/shared.ts" } })),
    );
    assert.equal(outcome.decision.kind, "ask");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the same Edit collision degrades to deny with the escalation prefix under Cursor", async () => {
  const root = tempRoot();
  try {
    coreFacade.presence.register(root, {
      provider: "claude",
      session: "other-session",
      pid: 1,
      branch: "main",
    });
    coreFacade.presence.heartbeat(root, {
      provider: "claude",
      session: "other-session",
      file: "src/shared.ts",
    });
    const outcome = await runHandler(
      toolBeforeHandler,
      stdinOf(cursorTool(root, { tool_name: "Edit", tool_input: { file_path: "src/shared.ts" } })),
    );
    assert.equal(outcome.decision.kind, "deny");
    if (outcome.decision.kind === "deny") {
      assert.match(outcome.decision.reason, /^Escalation unavailable on this provider — /);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an Edit with no matching foreign presence is allowed", async () => {
  const root = tempRoot();
  try {
    const outcome = await runHandler(
      toolBeforeHandler,
      stdinOf(cursorTool(root, { tool_name: "Edit", tool_input: { file_path: "src/untouched.ts" } })),
    );
    assert.equal(outcome.decision.kind, "allow");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an Edit where the only matching presence is the current session's own is allowed", async () => {
  const root = tempRoot();
  try {
    coreFacade.presence.register(root, { provider: "cursor", session: "conv-1", pid: 1, branch: "main" });
    coreFacade.presence.heartbeat(root, { provider: "cursor", session: "conv-1", file: "src/shared.ts" });
    const outcome = await runHandler(
      toolBeforeHandler,
      stdinOf(cursorTool(root, { tool_name: "Edit", tool_input: { file_path: "src/shared.ts" } })),
    );
    assert.equal(outcome.decision.kind, "allow");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a read-only subagent type attempting Write is denied", async () => {
  const root = tempRoot();
  try {
    const outcome = await runHandler(
      toolBeforeHandler,
      stdinOf(cursorTool(root, { tool_name: "Write", subagent_type: "explore" })),
    );
    assert.equal(outcome.decision.kind, "deny");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a read-only subagent type attempting an allowed tool is allowed", async () => {
  const root = tempRoot();
  try {
    const outcome = await runHandler(
      toolBeforeHandler,
      stdinOf(cursorTool(root, { tool_name: "Grep", subagent_type: "explore" })),
    );
    assert.equal(outcome.decision.kind, "allow");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
