import { join } from "node:path";
import type { ProviderWiring, RuntimePaths, WiringEntry } from "../../contracts/index.ts";
import { cursorConfigDir } from "../../platform/paths.ts";

type EntrySpec = {
  hookEvent: string;
  handler: string;
  timeoutSeconds: number;
  failClosed?: boolean;
  matcher?: string;
  loopLimit?: number;
};

// why: mirrors bin/write-user-hooks.mjs verbatim — same hook keys, timeouts, failClosed/matcher/loopLimit values, and handler order.
const ENTRY_SPECS: readonly EntrySpec[] = [
  { hookEvent: "sessionStart", handler: "session-start", timeoutSeconds: 10 },
  { hookEvent: "sessionEnd", handler: "session-end", timeoutSeconds: 10 },
  { hookEvent: "beforeSubmitPrompt", handler: "prompt-submit", timeoutSeconds: 5 },
  { hookEvent: "afterAgentThought", handler: "tool-after", timeoutSeconds: 5 },
  { hookEvent: "preCompact", handler: "compact-before", timeoutSeconds: 5 },
  { hookEvent: "subagentStart", handler: "subagent-start", timeoutSeconds: 5, failClosed: true },
  { hookEvent: "subagentStop", handler: "subagent-stop", timeoutSeconds: 5 },
  { hookEvent: "preToolUse", handler: "tool-before", timeoutSeconds: 5, failClosed: true },
  { hookEvent: "postToolUse", handler: "tool-after", timeoutSeconds: 5 },
  { hookEvent: "postToolUseFailure", handler: "tool-failure", timeoutSeconds: 5 },
  { hookEvent: "beforeShellExecution", handler: "tool-before", timeoutSeconds: 10, failClosed: true },
  { hookEvent: "afterShellExecution", handler: "tool-after", timeoutSeconds: 10 },
  { hookEvent: "beforeMCPExecution", handler: "tool-before", timeoutSeconds: 10 },
  { hookEvent: "afterMCPExecution", handler: "tool-after", timeoutSeconds: 5 },
  { hookEvent: "beforeReadFile", handler: "tool-before", timeoutSeconds: 5 },
  { hookEvent: "afterFileEdit", handler: "tool-after", timeoutSeconds: 30, matcher: "Write" },
  { hookEvent: "stop", handler: "stop", timeoutSeconds: 120, loopLimit: 5 },
  { hookEvent: "afterAgentResponse", handler: "response-after", timeoutSeconds: 5, matcher: "AgentResponse" },
];

function commandFor(runtime: RuntimePaths): { command: string; argsPrefix: string[] } {
  if (process.platform === "win32") {
    return { command: "cmd", argsPrefix: ["/c", "node", runtime.launcherPath] };
  }
  return { command: "node", argsPrefix: [runtime.launcherPath] };
}

export function cursorWiring(runtime: RuntimePaths): ProviderWiring {
  const { command, argsPrefix } = commandFor(runtime);
  const entries: WiringEntry[] = ENTRY_SPECS.map((spec) => ({
    hookEvent: spec.hookEvent,
    handler: spec.handler,
    command,
    args: [...argsPrefix, spec.handler],
    timeoutSeconds: spec.timeoutSeconds,
    ...(spec.failClosed !== undefined ? { failClosed: spec.failClosed } : {}),
    ...(spec.matcher !== undefined ? { matcher: spec.matcher } : {}),
    ...(spec.loopLimit !== undefined ? { loopLimit: spec.loopLimit } : {}),
  }));

  return {
    target: join(cursorConfigDir(), "hooks.json"),
    strategy: "replace",
    entries,
  };
}
