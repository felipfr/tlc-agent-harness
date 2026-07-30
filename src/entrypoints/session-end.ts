import type { Decision, HarnessEvent } from "../contracts/index.ts";
import { coreFacade } from "../core/index.ts";
import { renderClaudeLessonsView, renderCursorLessonsView } from "../providers/index.ts";
import type { Handler, HandlerContext } from "./run.ts";
import { main } from "./run.ts";
import { sessionIdFromKey } from "./support.ts";

function renderProviderLessonsView(providerName: string, root: string): string | null {
  if (providerName === "cursor") {
    return renderCursorLessonsView(root);
  }
  if (providerName === "claude") {
    return renderClaudeLessonsView(root);
  }
  return null;
}

export const sessionEndHandler: Handler = async (
  event: HarnessEvent,
  ctx: HandlerContext,
): Promise<Decision> => {
  const { policy } = ctx;
  const root = event.projectDir;
  const session = sessionIdFromKey(event);

  await coreFacade.handoff.patchHandoff(root, event.provider, {
    slice: {
      next_action: "Session ended. Read .tlc/harness/state/handoff.json before resuming.",
    },
  });

  coreFacade.presence.release(root, event.provider, session);
  coreFacade.turn.resetLoop(root, event.sessionKey);

  if (policy.intelligence.lessons.enabled && policy.intelligence.lessons.gardenOnSessionEnd) {
    const garden = await coreFacade.lesson.gardenAndPersistLessons(root, policy.intelligence.lessons);
    if (garden.markdownPath) {
      renderProviderLessonsView(event.provider, root);
    }
  }

  return { kind: "abstain" };
};

if (import.meta.main) {
  await main(sessionEndHandler);
}
