import { readSignalEvents } from "../observability/observability.store.ts";
import type { ObsEvent } from "../observability/observability.types.ts";

const TOOL_KINDS = new Set(["tool.start", "tool.end", "shell.start", "shell.end", "mcp.start", "mcp.end"]);
const TURN_START = "prompt.submit";

export type TurnActivity = {
  toolCalls: number;
  sawTurnStart: boolean;
};

function forSession(event: ObsEvent, sessionKey: string): boolean {
  return event.session_id === sessionKey;
}

export function activitySince(events: readonly ObsEvent[], sessionKey: string): TurnActivity {
  const mine = events.filter((event) => forSession(event, sessionKey));
  let startIndex = -1;
  for (let i = mine.length - 1; i >= 0; i--) {
    if (mine[i]?.kind === TURN_START) {
      startIndex = i;
      break;
    }
  }
  const window = startIndex >= 0 ? mine.slice(startIndex + 1) : mine;
  return {
    toolCalls: window.filter((event) => TOOL_KINDS.has(event.kind)).length,
    sawTurnStart: startIndex >= 0,
  };
}

export function readTurnActivity(root: string, sessionKey: string, limit = 500): TurnActivity {
  return activitySince(readSignalEvents(root, "obs.jsonl", limit), sessionKey);
}

export type IdleTurnInput = {
  activity: TurnActivity;
  changedFiles: number;
  hasOpenWork: boolean;
};

export function endedWithoutActing(input: IdleTurnInput): boolean {
  if (!input.hasOpenWork) {
    return false;
  }
  if (!input.activity.sawTurnStart) {
    return false;
  }
  return input.activity.toolCalls === 0 && input.changedFiles === 0;
}

export function idleTurnMessage(): string {
  return [
    "BLOCKED: this turn ended with open work, no tool call, and no file change.",
    "TRIED: counted tool events since the last prompt in this session — nothing ran.",
    "NEED: attempt the work. If a decision is genuinely blocking, state the assumption you are",
    "proceeding under in one line and continue; escalate only for an irreversible action, a real",
    "dead-end after searching, or ambiguity that would make the result useless if guessed wrong.",
  ].join("\n");
}
