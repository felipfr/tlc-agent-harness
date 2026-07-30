import type { HarnessEvent } from "../contracts/index.ts";
import { coreFacade, type ObservabilityConfig } from "../core/index.ts";
import type { Handler } from "./run.ts";
import { main } from "./run.ts";
import { OBS_CONFIG_AUDIT } from "./support.ts";

export const toolFailureHandler: Handler = (event: HarnessEvent) => {
  coreFacade.observability.recordAudit(event.projectDir, event.event, event.raw);

  coreFacade.observability.recordObs(event.projectDir, OBS_CONFIG_AUDIT, {
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
