import assert from "node:assert/strict";
import { test } from "node:test";
import { observeAttrs, shouldObserve } from "../observe.service.ts";

const ON = { enabled: true, rails: ["comments"] };

test("observation is off by default and off is the only silent state", () => {
  assert.equal(shouldObserve({ enabled: false, rails: ["comments"] }, "comments", false), false);
  assert.equal(shouldObserve({ enabled: true, rails: [] }, "comments", false), false);
  assert.equal(shouldObserve(ON, "comments", false), true);
});

// invariant: enforcement wins. An enforcing rail already records its own outcome, and observing it too would
// double-count — the operator would read twice the interruptions they lived through.
test("an enforcing rail is not observed", () => {
  assert.equal(shouldObserve(ON, "comments", true), false);
});

test("a rail that is not listed is inert rather than an error", () => {
  assert.equal(shouldObserve(ON, "plan", false), false);
});

// why: this is the whole point of the mode. The same zero means two different things, and only the prose flag
// separates them — "the rule worked" from "the rule was never needed".
test("zero violations reads differently depending on whether the prose was injected", () => {
  const withProse = observeAttrs({ rail: "comments", violations: 0, proseInjected: true });
  const without = observeAttrs({ rail: "comments", violations: 0, proseInjected: false });
  assert.equal(withProse.reading, "held-with-prose");
  assert.equal(without.reading, "held-without-prose");
  assert.notEqual(withProse.reading, without.reading);
});

test("a violation reads as a violation, and still says whether the prose was there", () => {
  assert.equal(
    observeAttrs({ rail: "comments", violations: 3, proseInjected: false }).reading,
    "violated-without-prose",
  );
  assert.equal(
    observeAttrs({ rail: "comments", violations: 3, proseInjected: true }).reading,
    "violated-with-prose",
  );
});

test("the record carries the count and the rail, not only the reading", () => {
  const attrs = observeAttrs({ rail: "comments", violations: 2, proseInjected: false });
  assert.equal(attrs.rail, "comments");
  assert.equal(attrs.violations, 2);
  assert.equal(attrs.prose_injected, false);
});
