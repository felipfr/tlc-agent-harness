import type { ProviderCapabilities } from "../../contracts/index.ts";

export function cursorCapabilities(): ProviderCapabilities {
  return {
    enforcesHooks: true,
    askSupportedOn: ["shell.before", "mcp.before"],
    sessionEnv: true,
    nativeLoopCounter: true,
    dedicatedShellEvent: true,
    toolInputRewrite: true,
    toolOutputRewrite: true,
    contextAtToolBefore: false,
    contextAtToolAfter: true,
    usageInPayload: true,
    effortSignal: false,
    thoughtEvent: true,
  };
}
