import type { HarnessEvent } from "../contracts/index.ts";
import { coreFacade } from "../core/index.ts";
import type { Handler, HandlerContext } from "./run.ts";
import { main } from "./run.ts";
import { OBS_CONFIG_AUDIT, obsConfigFor } from "./support.ts";

export const toolFailureHandler: Handler = (event: HarnessEvent, ctx: HandlerContext) => {
  coreFacade.observability.recordAudit(event.projectDir, event.event, event.raw, ctx.policy.obs.globalSpool);

  coreFacade.observability.recordObs(event.projectDir, obsConfigFor(ctx.policy, OBS_CONFIG_AUDIT), {
    provider: event.provider,
    kind: "tool.fail",
    sessionKey: event.sessionKey,
    model: event.model,
    attrs: {
      tool_name: event.toolName,
      file_path: event.filePath,
      status: event.status,
    },
  });
  return { kind: "abstain" };
};

if (import.meta.main) {
  await main(toolFailureHandler);
}
