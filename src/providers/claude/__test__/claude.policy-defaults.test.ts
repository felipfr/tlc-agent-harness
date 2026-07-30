import assert from "node:assert/strict";
import { test } from "node:test";
import { claudePolicyDefaults } from "../claude.policy-defaults.ts";

test("claudePolicyDefaults carries the real Claude model catalog", () => {
  const defaults = claudePolicyDefaults();
  assert.deepEqual(defaults.allowedModels, ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"]);
});

test("claudePolicyDefaults has no blocked model-name patterns — the quality axis is effort, not a model suffix", () => {
  assert.deepEqual(claudePolicyDefaults().blockedPatterns, []);
});

test("claudePolicyDefaults sets no minimum effort by default", () => {
  assert.equal(claudePolicyDefaults().minEffort, null);
});
