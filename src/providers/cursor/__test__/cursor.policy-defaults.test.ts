import assert from "node:assert/strict";
import { test } from "node:test";
import { cursorPolicyDefaults } from "../cursor.policy-defaults.ts";

test("cursorPolicyDefaults carries the real Cursor model catalog", () => {
  const defaults = cursorPolicyDefaults();
  assert.deepEqual(defaults.allowedModels, [
    "composer-2.5",
    "cursor-grok-4.5-high",
    "glm-5.2-high",
    "kimi-k2.7-code",
    "gpt-5.3-codex-high",
  ]);
});

test("cursorPolicyDefaults blocks -fast and /fast suffixes plus the composer-2.5-fast literal", () => {
  const defaults = cursorPolicyDefaults();
  assert.deepEqual(defaults.blockedPatterns, [
    "-fast(?:$|[^a-z0-9])",
    "/fast(?:$|[^a-z0-9])",
    "composer-2\\.5-fast",
  ]);
});

test("cursorPolicyDefaults sets no minimum effort", () => {
  assert.equal(cursorPolicyDefaults().minEffort, null);
});
