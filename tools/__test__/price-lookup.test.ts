import assert from "node:assert/strict";
import { test } from "node:test";
import { lookupPrice, parsePriceLookupArgs } from "../price-lookup.ts";

test("parsePriceLookupArgs returns null with no model given", () => {
  assert.equal(parsePriceLookupArgs([]), null);
});

test("parsePriceLookupArgs defaults provider to empty string when omitted", () => {
  assert.deepEqual(parsePriceLookupArgs(["some-model"]), { model: "some-model", provider: "" });
});

test("parsePriceLookupArgs carries an explicit provider through", () => {
  assert.deepEqual(parsePriceLookupArgs(["some-model", "provider-a"]), {
    model: "some-model",
    provider: "provider-a",
  });
});

test("lookupPrice reports an unresolved model as missing rather than throwing", () => {
  const result = lookupPrice({ model: "no-such-model-xyz", provider: "no-such-provider" });
  assert.equal(result.resolved, undefined);
  assert.equal(result.per1M.costUsd, null);
  assert.equal(result.per1M.source, "missing");
});
