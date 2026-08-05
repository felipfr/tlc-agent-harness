import type { ProviderCapabilities } from "../../contracts/index.ts";

export function claudeCapabilities(): ProviderCapabilities {
  return {
    enforcesHooks: true,
    askSupportedOn: ["tool.before", "shell.before", "mcp.before", "read.before"],
    sessionEnv: false,
    nativeLoopCounter: false,
    dedicatedShellEvent: false,
    toolInputRewrite: true,
    toolOutputRewrite: true,
    contextAtToolBefore: true,
    contextAtToolAfter: true,
    contextAtStop: true,
    sessionStartContextReliable: true,
    usageInPayload: false,
    effortSignal: true,
    thoughtEvent: false,
  };
}
