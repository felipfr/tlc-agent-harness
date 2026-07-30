import assert from "node:assert/strict";
import { test } from "node:test";
import { groupByProvider, sessionReportMarkdown } from "../observability.report.ts";
import { newRollup } from "../observability.store.ts";
import type { ObsEvent } from "../observability.types.ts";

function makeEvent(overrides: Partial<ObsEvent>): ObsEvent {
  return {
    schema: "harness.observability.v1",
    provider: "provider-a",
    kind: "policy.deny",
    level: "signal",
    ts: new Date().toISOString(),
    trace_id: "trace",
    span_id: "span",
    attrs: {},
    ...overrides,
  };
}

test("a mixed-provider log yields exactly two groups", () => {
  const groups = groupByProvider([
    makeEvent({ provider: "provider-a" }),
    makeEvent({ provider: "provider-a" }),
    makeEvent({ provider: "provider-b" }),
  ]);
  assert.deepEqual(Object.keys(groups).sort(), ["provider-a", "provider-b"]);
  assert.equal(groups["provider-a"]?.events, 2);
  assert.equal(groups["provider-b"]?.events, 1);
});

test("groupByProvider counts policy denials per provider", () => {
  const groups = groupByProvider([
    makeEvent({ provider: "provider-a", kind: "policy.deny" }),
    makeEvent({ provider: "provider-b", kind: "session.start" }),
  ]);
  assert.equal(groups["provider-a"]?.denials, 1);
  assert.equal(groups["provider-b"]?.denials, 0);
});

test("groupByProvider sums estimated cost per provider", () => {
  const groups = groupByProvider([
    makeEvent({ provider: "provider-a", gen_ai: { cost_usd: 0.1 } }),
    makeEvent({ provider: "provider-a", gen_ai: { cost_usd: 0.2 } }),
  ]);
  assert.ok(Math.abs((groups["provider-a"]?.estimated_cost_usd ?? 0) - 0.3) < 1e-9);
});

test("groupByProvider on an empty log returns no groups", () => {
  assert.deepEqual(groupByProvider([]), {});
});

test("sessionReportMarkdown names the owning provider and session", () => {
  const rollup = newRollup("session-a", "provider-a");
  const markdown = sessionReportMarkdown(rollup);
  assert.ok(markdown.includes("provider-a"));
  assert.ok(markdown.includes("session-a"));
});

test("sessionReportMarkdown flags an incomplete cost estimate", () => {
  const rollup = newRollup("session-a", "provider-a");
  rollup.cost_incomplete = true;
  const markdown = sessionReportMarkdown(rollup);
  assert.ok(markdown.includes("incomplete"));
});
