import assert from "node:assert/strict";
import { test } from "node:test";
import { HARNESS_EVENT_KINDS } from "../../../contracts/harness-event.ts";
import {
  EVENT_KIND_TO_OBS_KIND,
  LIVE_ALLOWLIST,
  redactDeep,
  resolveObsLevel,
  SIGNAL_KINDS,
} from "../observability.types.ts";

test("every harness event kind maps to an obs kind", () => {
  for (const kind of HARNESS_EVENT_KINDS) {
    assert.ok(EVENT_KIND_TO_OBS_KIND[kind], `missing mapping for ${kind}`);
  }
});

test("resolveObsLevel treats an allowed shell as debug and a denied shell as signal", () => {
  assert.equal(resolveObsLevel("shell.end", { permission: "allow" }), "debug");
  assert.equal(resolveObsLevel("shell.end", { permission: "deny" }), "signal");
});

test("resolveObsLevel treats a successful mcp call as debug and an errored one as signal", () => {
  assert.equal(resolveObsLevel("mcp.end", { outcome: "success" }), "debug");
  assert.equal(resolveObsLevel("mcp.end", { outcome: "error" }), "signal");
});

test("resolveObsLevel falls back to the signal-kinds table for other kinds", () => {
  assert.equal(resolveObsLevel("policy.deny"), "signal");
  assert.equal(resolveObsLevel("tool.start"), "debug");
});

test("forceDebug always wins regardless of kind", () => {
  assert.equal(resolveObsLevel("policy.deny", {}, true), "debug");
});

test("SIGNAL_KINDS and LIVE_ALLOWLIST are non-empty and disjoint from nothing by construction", () => {
  assert.ok(SIGNAL_KINDS.has("gate.outcome"));
  assert.ok(LIVE_ALLOWLIST.has("cost.session_alert"));
});

test("redactDeep masks a secret-shaped key regardless of nesting depth", () => {
  const redacted = redactDeep({ outer: { api_key: "shh", note: "fine" } }) as {
    outer: { api_key: string; note: string };
  };
  assert.equal(redacted.outer.api_key, "[REDACTED]");
  assert.equal(redacted.outer.note, "fine");
});

test("redactDeep masks a token-shaped literal embedded in free text", () => {
  const redacted = redactDeep("token is sk-abcdefghijklmnopqrstuvwx here") as string;
  assert.ok(redacted.includes("[REDACTED]"));
  assert.ok(!redacted.includes("sk-abcdefghijklmnopqrstuvwx"));
});
