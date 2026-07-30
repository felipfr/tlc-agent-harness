import assert from "node:assert/strict";
import { test } from "node:test";
import { activitySince, endedWithoutActing } from "../turn.activity.ts";

function event(kind: string, session = "provider-a-s1"): Record<string, unknown> {
  return { schema: "harness.observability.v1", kind, session_id: session, level: "signal" };
}

test("counts only tool events after the last prompt in this session", () => {
  const events = [
    event("prompt.submit"),
    event("tool.start"),
    event("prompt.submit"),
    event("tool.start"),
    event("shell.end"),
  ] as never[];
  const activity = activitySince(events, "provider-a-s1");
  assert.equal(activity.sawTurnStart, true);
  assert.equal(activity.toolCalls, 2);
});

test("another session's tool calls never count toward this one", () => {
  const events = [
    event("prompt.submit", "provider-a-s1"),
    event("tool.start", "provider-b-s9"),
    event("shell.end", "provider-b-s9"),
  ] as never[];
  assert.equal(activitySince(events, "provider-a-s1").toolCalls, 0);
});

test("a turn with no prompt boundary reports it rather than guessing", () => {
  const activity = activitySince([event("tool.start")] as never[], "provider-a-s1");
  assert.equal(activity.sawTurnStart, false);
});

test("open work with no tool call and no diff is an idle turn", () => {
  assert.equal(
    endedWithoutActing({
      activity: { toolCalls: 0, sawTurnStart: true },
      changedFiles: 0,
      hasOpenWork: true,
    }),
    true,
  );
});

test("a single tool call is enough to clear the gate", () => {
  assert.equal(
    endedWithoutActing({
      activity: { toolCalls: 1, sawTurnStart: true },
      changedFiles: 0,
      hasOpenWork: true,
    }),
    false,
  );
});

test("a file change clears the gate even with no recorded tool call", () => {
  assert.equal(
    endedWithoutActing({
      activity: { toolCalls: 0, sawTurnStart: true },
      changedFiles: 3,
      hasOpenWork: true,
    }),
    false,
  );
});

test("no open work means an empty turn is legitimate", () => {
  assert.equal(
    endedWithoutActing({
      activity: { toolCalls: 0, sawTurnStart: true },
      changedFiles: 0,
      hasOpenWork: false,
    }),
    false,
  );
});

test("without a prompt boundary the gate abstains rather than false-blocking", () => {
  assert.equal(
    endedWithoutActing({
      activity: { toolCalls: 0, sawTurnStart: false },
      changedFiles: 0,
      hasOpenWork: true,
    }),
    false,
  );
});
