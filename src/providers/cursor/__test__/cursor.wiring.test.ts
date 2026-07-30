import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { cursorWiring } from "../cursor.wiring.ts";

const RUNTIME = { launcherPath: "/opt/tlc/bin/tlc-exec.mjs" };

test("target is ~/.cursor/hooks.json with the replace strategy", () => {
  const wiring = cursorWiring(RUNTIME);
  assert.equal(wiring.target, join(homedir(), ".cursor", "hooks.json"));
  assert.equal(wiring.strategy, "replace");
});

test("every hook event the predecessor wired is still covered", () => {
  const wiring = cursorWiring(RUNTIME);
  const hookKeys = new Set(wiring.entries.map((entry) => entry.hookEvent));
  assert.deepEqual(
    [...hookKeys].sort(),
    [
      "afterAgentResponse",
      "afterAgentThought",
      "afterFileEdit",
      "afterMCPExecution",
      "afterShellExecution",
      "beforeMCPExecution",
      "beforeReadFile",
      "beforeShellExecution",
      "beforeSubmitPrompt",
      "postToolUse",
      "postToolUseFailure",
      "preCompact",
      "preToolUse",
      "sessionEnd",
      "sessionStart",
      "stop",
      "subagentStart",
      "subagentStop",
    ].sort(),
  );
  assert.equal(wiring.entries.length, 18);
});

test("sessionStart keeps its 10-second timeout and carries no failClosed", () => {
  const wiring = cursorWiring(RUNTIME);
  const entry = wiring.entries.find((e) => e.hookEvent === "sessionStart");
  assert.equal(entry?.handler, "session-start");
  assert.equal(entry?.timeoutSeconds, 10);
  assert.equal(entry?.failClosed, undefined);
});

test("preToolUse and beforeShellExecution keep failClosed: true", () => {
  const wiring = cursorWiring(RUNTIME);
  const preToolUse = wiring.entries.find((e) => e.hookEvent === "preToolUse");
  const beforeShell = wiring.entries.find((e) => e.hookEvent === "beforeShellExecution");
  assert.equal(preToolUse?.failClosed, true);
  assert.equal(beforeShell?.failClosed, true);
});

test("stop keeps the 120-second timeout and loop_limit of 5", () => {
  const wiring = cursorWiring(RUNTIME);
  const stop = wiring.entries.find((e) => e.hookEvent === "stop");
  assert.equal(stop?.handler, "stop");
  assert.equal(stop?.timeoutSeconds, 120);
  assert.equal(stop?.loopLimit, 5);
});

test("every handler names a real entrypoint file", () => {
  const wiring = cursorWiring(RUNTIME);
  const entrypoints = new Set(
    readdirSync(join(fileURLToPath(new URL("../../../entrypoints/", import.meta.url))))
      .filter((f) => f.endsWith(".ts"))
      .map((f) => f.replace(/\.ts$/, "")),
  );
  for (const entry of wiring.entries) {
    assert.ok(entrypoints.has(entry.handler), `no entrypoint for handler "${entry.handler}"`);
  }
});

test("afterFileEdit and afterAgentResponse keep their matchers", () => {
  const wiring = cursorWiring(RUNTIME);
  const afterFileEdit = wiring.entries.find((e) => e.hookEvent === "afterFileEdit");
  const afterAgentResponse = wiring.entries.find((e) => e.hookEvent === "afterAgentResponse");
  assert.equal(afterFileEdit?.matcher, "Write");
  assert.equal(afterAgentResponse?.matcher, "AgentResponse");
});

test("commands point at the launcher path — node on non-Windows, cmd /c on Windows", () => {
  const posix = cursorWiring(RUNTIME).entries[0];
  assert.equal(posix?.command, process.platform === "win32" ? "cmd" : "node");

  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: "win32" });
  try {
    const win = cursorWiring(RUNTIME).entries[0];
    assert.equal(win?.command, "cmd");
    assert.deepEqual(win?.args.slice(0, 2), ["/c", "node"]);
    assert.ok(win?.args.includes(RUNTIME.launcherPath));
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  }
});
