import type { HarnessEvent } from "../contracts/index.ts";
import { coreFacade } from "../core/index.ts";
import type { Handler, HandlerContext } from "./run.ts";
import { main } from "./run.ts";
import { obsConfigFor } from "./support.ts";

export const promptSubmitHandler: Handler = (event: HarnessEvent, ctx: HandlerContext) => {
  coreFacade.observability.recordFromEvent(event.projectDir, obsConfigFor(ctx.policy), event);
  // why: the prompt is the turn boundary, so this is where the once-per-turn framing marker resets.
  coreFacade.untrusted.clearFramingMarker(event.projectDir, event.sessionKey);
  return { kind: "abstain" };
};

if (import.meta.main) {
  await main(promptSubmitHandler);
}
