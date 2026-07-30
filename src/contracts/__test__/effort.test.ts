import assert from "node:assert/strict";
import { test } from "node:test";
import { compareEffort, EFFORT_LEVELS, effortOrdinal, isEffortLevel } from "../effort.ts";

test("EFFORT_LEVELS has the five documented levels, in ascending order", () => {
  assert.deepEqual(EFFORT_LEVELS, ["low", "medium", "high", "xhigh", "max"]);
});

test("isEffortLevel accepts xhigh and max", () => {
  assert.equal(isEffortLevel("xhigh"), true);
  assert.equal(isEffortLevel("max"), true);
});

test("isEffortLevel rejects unknown strings and non-strings", () => {
  assert.equal(isEffortLevel("extreme"), false);
  assert.equal(isEffortLevel(42), false);
  assert.equal(isEffortLevel(undefined), false);
});

test("xhigh and max order strictly above high", () => {
  assert.ok(compareEffort("xhigh", "high") > 0);
  assert.ok(compareEffort("max", "high") > 0);
  assert.ok(compareEffort("max", "xhigh") > 0);
});

test("effortOrdinal places xhigh and max at indices 3 and 4", () => {
  assert.equal(effortOrdinal("xhigh"), 3);
  assert.equal(effortOrdinal("max"), 4);
});
