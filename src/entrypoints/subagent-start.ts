import type { Decision, HarnessEvent } from "../contracts/index.ts";
import { coreFacade } from "../core/index.ts";
import type { Handler, HandlerContext } from "./run.ts";
import { main } from "./run.ts";
import { effectiveAllowedModels, effectiveBlockedPatterns, effectiveMinEffort } from "./support.ts";

export const subagentStartHandler: Handler = (event: HarnessEvent, ctx: HandlerContext): Decision => {
  const { policy, provider } = ctx;
  return coreFacade.subagentPolicy.evaluateSubagentSpawn({
    provider: provider.name,
    sessionKey: event.sessionKey,
    projectDir: event.projectDir,
    model: event.spawnModel ?? "",
    effort: event.effort,
    allowedModels: effectiveAllowedModels(policy.subagents.allowedModels, provider),
    blockedPatterns: effectiveBlockedPatterns(policy.subagents.blockedPatterns, provider),
    minEffort: effectiveMinEffort(policy.subagents.minEffort, provider),
    requireModel: policy.subagents.requireModel,
    enforceAllowlist: policy.subagents.enforceAllowlist,
    blockParentFast: policy.subagents.blockParentFast,
    blockMode: policy.subagents.blockMode,
  });
};

if (import.meta.main) {
  await main(subagentStartHandler);
}
