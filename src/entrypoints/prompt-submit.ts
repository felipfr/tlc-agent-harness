import type { HarnessEvent } from "../contracts/index.ts";
import { coreFacade } from "../core/index.ts";
import type { Handler } from "./run.ts";
import { main } from "./run.ts";
import { OBS_CONFIG } from "./support.ts";

export const promptSubmitHandler: Handler = (event: HarnessEvent) => {
  coreFacade.observability.recordFromEvent(event.projectDir, OBS_CONFIG, event);
  return { kind: "abstain" };
};

if (import.meta.main) {
  await main(promptSubmitHandler);
}
