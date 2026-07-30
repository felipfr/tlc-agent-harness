import type { HarnessEvent } from "../contracts/index.ts";
import { coreFacade } from "../core/index.ts";
import type { Handler, HandlerContext } from "./run.ts";
import { main } from "./run.ts";
import { obsConfigFor } from "./support.ts";

export const compactBeforeHandler: Handler = (event: HarnessEvent, ctx: HandlerContext) => {
  coreFacade.observability.recordFromEvent(event.projectDir, obsConfigFor(ctx.policy), event);
  return { kind: "abstain" };
};

if (import.meta.main) {
  await main(compactBeforeHandler);
}
