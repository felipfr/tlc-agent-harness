import assert from "node:assert/strict";
import { test } from "node:test";
import { forProvider } from "../policy.types.ts";

test("forProvider returns undefined-scoped restriction as null", () => {
  assert.equal(forProvider(undefined, "provider-a"), null);
});

test("forProvider applies a bare array to every provider", () => {
  const scoped = ["model-x", "model-y"];
  assert.deepEqual(forProvider(scoped, "provider-a"), scoped);
  assert.deepEqual(forProvider(scoped, "provider-b"), scoped);
});

test("forProvider returns the keyed list for a matching provider", () => {
  const scoped = { "provider-a": ["model-x"], "provider-b": ["model-y"] };
  assert.deepEqual(forProvider(scoped, "provider-a"), ["model-x"]);
  assert.deepEqual(forProvider(scoped, "provider-b"), ["model-y"]);
});

test("forProvider returns null when the provider key is absent from the map", () => {
  const scoped = { "provider-a": ["model-x"] };
  assert.equal(forProvider(scoped, "provider-b"), null);
});
