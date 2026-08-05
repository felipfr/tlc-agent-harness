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
  contextAtStop: boolean;
  /**
   * Whether context returned from the session-start hook reaches the model. Cursor accepts the field and logs it as
   * merged, then drops it — its own staff called it "a bug on our side… a timing issue between when the hook runs and
   * when the composer handle is created" (forum 158452, 2026-04-20; still reported against 3.14.7 on 2026-08-02).
   * A host that declares false needs the durable provider view to carry lessons ([/decisions/ad-050.md](/decisions/ad-050.md)).
   */
  sessionStartContextReliable: boolean;
  usageInPayload: boolean;
  effortSignal: boolean;
  thoughtEvent: boolean;
};
