import assert from "node:assert/strict";
import { test } from "node:test";
import { groupByProvider, railsNeverFired, sessionReportMarkdown } from "../observability.report.ts";
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

// why: a count without an attribution names no switch. Six asks from the paired posture and one from the
// catastrophic rule call for two different responses, and "7" calls for neither.
test("sessionReportMarkdown attributes the interruptions to their rules", () => {
  const rollup = newRollup("session-a", "provider-a");
  rollup.shell.ask = 7;
  rollup.shell.byRule = { "shell-posture-paired": 6, "shell-catastrophic": 1 };
  const markdown = sessionReportMarkdown(rollup);
  assert.match(markdown, /shell-posture-paired \| 6/);
  assert.match(markdown, /shell-catastrophic \| 1/);
  // why: ordered by weight, so the rule doing the interrupting is the first thing read.
  assert.ok(
    markdown.indexOf("shell-posture-paired") < markdown.indexOf("shell-catastrophic"),
    "the breakdown is not ordered by count",
  );
});

test("a session with no interruptions renders no breakdown", () => {
  const markdown = sessionReportMarkdown(newRollup("session-a", "provider-a"));
  assert.doesNotMatch(markdown, /↳/);
});

// invariant: the harness records the decisions it made. It never sees the operator's answer, and it cannot see
// whether a question it did not ask would have helped — so precision and recall over blockers are outside what it
// can compute. Naming the metric while measuring half of it is the class of claim this project keeps removing.
test("the report claims no metric it cannot compute", () => {
  const rollup = newRollup("session-a", "provider-a");
  rollup.shell.byRule = { "shell-posture-paired": 2 };
  const markdown = sessionReportMarkdown(rollup);
  for (const claim of ["Ask-F1", "precision", "recall", "F1"]) {
    assert.equal(markdown.includes(claim), false, claim);
  }
});

// hazard: a rollup written by an older build has no `byRule`, and the report runs on whatever is on disk.
test("a rollup from an older build renders instead of throwing", () => {
  const rollup = newRollup("session-a", "provider-a");
  (rollup.shell as { byRule?: Record<string, number> }).byRule = undefined;
  assert.doesNotThrow(() => sessionReportMarkdown(rollup));
});

// why: the question that decides something. A rail that never fired is either working perfectly or was never
// needed, and either way it is paying for injected prose on every turn.
test("railsNeverFired names an enabled rail with no firings and omits one that fired", () => {
  const rollup = newRollup("session-a", "provider-a");
  rollup.railsByRule = { "shell-posture-paired": 3 };
  assert.deepEqual(railsNeverFired(rollup, ["shell-posture-paired", "shell-catastrophic", "comments"]), [
    "comments",
    "shell-catastrophic",
  ]);
});

// invariant: the active list is a parameter. A report that guessed it would accuse a rail nobody switched on.
test("railsNeverFired reports nothing when no rail is declared active", () => {
  const rollup = newRollup("session-a", "provider-a");
  rollup.railsByRule = { "shell-catastrophic": 1 };
  assert.deepEqual(railsNeverFired(rollup, []), []);
});

test("the report names the silent rails and the price of the prose", () => {
  const rollup = newRollup("session-a", "provider-a");
  rollup.railsByRule = { "shell-posture-paired": 4 };
  rollup.injected_chars = 2480;
  const markdown = sessionReportMarkdown(rollup, ["shell-posture-paired", "comments"]);
  assert.match(markdown, /shell-posture-paired \| 4/);
  assert.match(markdown, /comments \| 0 — enabled and never fired/);
  assert.match(markdown, /2480 characters/);
});

test("a per-gate breakdown separates one flaky gate from a broken build", () => {
  const rollup = newRollup("session-a", "provider-a");
  rollup.gates = { pass: 3, fail: 2 };
  rollup.gatesByName = { lint: { pass: 3, fail: 0 }, test: { pass: 0, fail: 2 } };
  const markdown = sessionReportMarkdown(rollup, []);
  assert.match(markdown, /↳ test \| 0 \/ 2/);
  assert.match(markdown, /↳ lint \| 3 \/ 0/);
});

// hazard: a rollup written by an older build has none of these fields, and the report runs on whatever is on disk.
test("a rollup from an older build renders instead of throwing", () => {
  const rollup = newRollup("session-a", "provider-a") as unknown as Record<string, unknown>;
  rollup.railsByRule = undefined;
  rollup.gatesByName = undefined;
  assert.doesNotThrow(() => sessionReportMarkdown(rollup as never, ["comments"]));
});

test("with no rail activity at all the report grows no rails section", () => {
  const markdown = sessionReportMarkdown(newRollup("session-a", "provider-a"), []);
  assert.doesNotMatch(markdown, /## Rails/);
});
