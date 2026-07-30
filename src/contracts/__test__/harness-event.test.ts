import assert from "node:assert/strict";
import { test } from "node:test";
import { HARNESS_EVENT_KINDS } from "../harness-event.ts";

test("HARNESS_EVENT_KINDS has 18 entries including mcp.after and thought.after", () => {
  assert.equal(HARNESS_EVENT_KINDS.length, 18);
  assert.ok(HARNESS_EVENT_KINDS.includes("mcp.after"));
  assert.ok(HARNESS_EVENT_KINDS.includes("thought.after"));
});
