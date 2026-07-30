import type { Decision, HarnessEvent } from "../contracts/index.ts";
import { coreFacade } from "../core/index.ts";
import type { Handler, HandlerContext } from "./run.ts";
import { main } from "./run.ts";

export const responseAfterHandler: Handler = async (
  event: HarnessEvent,
  ctx: HandlerContext,
): Promise<Decision> => {
  const claim = coreFacade.ship.detectShipClaim(event.text ?? "");
  if (claim) {
    await coreFacade.handoff.patchHandoff(event.projectDir, event.provider, {
      slice: {
        last_ship_claim_at: ctx.now.toISOString(),
        last_ship_claim_snippet: claim.snippet,
        last_ship_claim_kind: claim.kind,
      },
    });
    coreFacade.ship.appendShipLedger(event.projectDir, {
      provider: event.provider,
      event: "claim",
      claimKind: claim.kind,
      detail: claim.snippet,
    });
  }
  return { kind: "abstain" };
};

if (import.meta.main) {
  await main(responseAfterHandler);
}
