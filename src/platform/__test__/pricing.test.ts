import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { estimateCostUsd, mapPoolToNeutral, resolveModelPrice, type VendorPool } from "../pricing.ts";

let dir: string;
let previousTlcHome: string | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tlc-pricing-test-"));
  previousTlcHome = process.env.TLC_HOME;
  process.env.TLC_HOME = dir;
});

afterEach(() => {
  if (previousTlcHome === undefined) {
    delete process.env.TLC_HOME;
  } else {
    process.env.TLC_HOME = previousTlcHome;
  }
  rmSync(dir, { recursive: true, force: true });
});

function writeCatalog(name: string, table: Record<string, unknown>): void {
  writeFileSync(join(dir, name), JSON.stringify(table), "utf8");
}

test("overrides win over the provider-native catalog and litellm", () => {
  writeCatalog("model-prices.json", { "model-a": { promptPer1M: 1, completionPer1M: 2, pool: "unknown" } });
  writeCatalog("model-prices.testprov.json", { "model-a": { promptPer1M: 100, completionPer1M: 100 } });
  writeCatalog("model-prices.litellm.json", { "model-a": { promptPer1M: 200, completionPer1M: 200 } });
  const resolved = resolveModelPrice("testprov", "model-a");
  assert.equal(resolved?.source, "override");
  assert.equal(resolved?.entry.promptPer1M, 1);
});

test("the provider-native catalog wins over litellm when there is no override", () => {
  writeCatalog("model-prices.testprov.json", { "model-b": { promptPer1M: 5, completionPer1M: 5 } });
  writeCatalog("model-prices.litellm.json", { "model-b": { promptPer1M: 9, completionPer1M: 9 } });
  const resolved = resolveModelPrice("testprov", "model-b");
  assert.equal(resolved?.source, "provider");
  assert.equal(resolved?.entry.promptPer1M, 5);
});

test("litellm is used when there is no override and no provider-native entry", () => {
  writeCatalog("model-prices.litellm.json", { "model-c": { promptPer1M: 3, completionPer1M: 3 } });
  const resolved = resolveModelPrice("testprov", "model-c");
  assert.equal(resolved?.source, "litellm");
});

test("an unknown model id yields null cost with cost_source missing", () => {
  const estimate = estimateCostUsd("testprov", "totally-unknown-model", { inputTokens: 10, outputTokens: 5 });
  assert.equal(estimate.costUsd, null);
  assert.equal(estimate.source, "missing");
  assert.equal(estimate.pool, "unknown");
});

test("an absent catalog file returns undefined rather than throwing", () => {
  assert.doesNotThrow(() => resolveModelPrice("testprov", "anything"));
  assert.equal(resolveModelPrice("testprov", "anything"), undefined);
});

test("a claude-* id resolves from the litellm catalog with the anthropic_models vendor pool", () => {
  writeCatalog("model-prices.litellm.json", {
    "claude-opus-5": { promptPer1M: 15, completionPer1M: 75, pool: "anthropic_models", billing: "metered" },
  });
  const resolved = resolveModelPrice("claude", "claude-opus-5");
  assert.equal(resolved?.source, "litellm");
  assert.equal(resolved?.entry.pool, "anthropic_models");
  assert.equal(mapPoolToNeutral(resolved?.entry.pool as VendorPool), "provider_native");
});

test("estimateCostUsd computes metered cost from prompt and completion tokens", () => {
  writeCatalog("model-prices.litellm.json", {
    "model-d": { promptPer1M: 2, completionPer1M: 4, pool: "other_models", billing: "metered" },
  });
  const estimate = estimateCostUsd("testprov", "model-d", {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  assert.equal(estimate.costUsd, 6);
  assert.equal(estimate.billing, "metered");
});

test("estimateCostUsd adds cache read and cache write costs", () => {
  writeCatalog("model-prices.litellm.json", {
    "model-e": { promptPer1M: 1, completionPer1M: 1, cacheReadPer1M: 0.1, cacheWritePer1M: 0.5 },
  });
  const estimate = estimateCostUsd("testprov", "model-e", {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    cacheWriteTokens: 1_000_000,
  });
  assert.equal(estimate.costUsd, 2.6);
});

test("a billing:included entry returns null cost and billing included", () => {
  writeCatalog("model-prices.litellm.json", { "model-f": { billing: "included" } });
  const estimate = estimateCostUsd("testprov", "model-f", { inputTokens: 10, outputTokens: 10 });
  assert.equal(estimate.costUsd, null);
  assert.equal(estimate.billing, "included");
});

test("no model and zero usage short-circuits to missing without resolving a catalog", () => {
  const estimate = estimateCostUsd("testprov", undefined, {});
  assert.equal(estimate.costUsd, null);
  assert.equal(estimate.source, "missing");
});

test("mapPoolToNeutral maps every vendor pool to the correct neutral pool", () => {
  assert.equal(mapPoolToNeutral("cursor_models"), "provider_native");
  assert.equal(mapPoolToNeutral("anthropic_models"), "provider_native");
  assert.equal(mapPoolToNeutral("other_models"), "other");
  assert.equal(mapPoolToNeutral("auto"), "auto");
  assert.equal(mapPoolToNeutral("unknown"), "unknown");
});

test("an empty model string never throws and resolves to undefined", () => {
  assert.doesNotThrow(() => resolveModelPrice("testprov", ""));
  assert.equal(resolveModelPrice("testprov", ""), undefined);
});

test("an alias in model-aliases.json redirects to the real catalog key", () => {
  writeCatalog("model-prices.litellm.json", { "real-model-name": { promptPer1M: 1, completionPer1M: 1 } });
  writeCatalog("model-aliases.json", { "friendly-name": "real-model-name" });
  const resolved = resolveModelPrice("testprov", "friendly-name");
  assert.equal(resolved?.key, "real-model-name");
});

test("a model id with parenthetical noise still resolves via the slug fallback", () => {
  writeCatalog("model-prices.litellm.json", { "some-model": { promptPer1M: 1, completionPer1M: 1 } });
  const resolved = resolveModelPrice("testprov", "Some Model (extra info)");
  assert.equal(resolved?.key, "some-model");
});
