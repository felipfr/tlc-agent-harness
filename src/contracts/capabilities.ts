import type { HarnessEventKind } from "./harness-event.ts";

export type ProviderCapabilities = {
  enforcesHooks: boolean;
  askSupportedOn: HarnessEventKind[];
  sessionEnv: boolean;
  nativeLoopCounter: boolean;
  dedicatedShellEvent: boolean;
  toolInputRewrite: boolean;
  toolOutputRewrite: boolean;
  contextAtToolBefore: boolean;
  contextAtToolAfter: boolean;
  usageInPayload: boolean;
  effortSignal: boolean;
  thoughtEvent: boolean;
};
