import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_LESSONS_POLICY } from "../../policy/policy.defaults.ts";
import { durableViewVerdict, lessonsSyncMode, resolveSyncMode } from "../lesson.sync.ts";

const RELIABLE = true;
const UNRELIABLE = false;

/**
 * hazard: an operator on a host that drops hook context had exactly one route to the model, and it was off by
 * default. `auto` asks the host instead of asking the operator to know which of the two applies
 * ([/decisions/ad-050.md](/decisions/ad-050.md)).
 */
test("auto writes the view where the host does not deliver hook context", () => {
  const verdict = durableViewVerdict("auto", UNRELIABLE);
  assert.equal(verdict.writes, true);
  assert.match(verdict.reason, /does not deliver context/);
});

// invariant: the control. Without this, "auto always writes" would pass the test above.
test("auto withholds the view where the host does deliver hook context", () => {
  const verdict = durableViewVerdict("auto", RELIABLE);
  assert.equal(verdict.writes, false);
  assert.match(verdict.reason, /delivers context/);
});

test("always writes on both kinds of host", () => {
  assert.equal(durableViewVerdict("always", RELIABLE).writes, true);
  assert.equal(durableViewVerdict("always", UNRELIABLE).writes, true);
});

test("never writes on neither, and says which setting decided it", () => {
  assert.equal(durableViewVerdict("never", RELIABLE).writes, false);
  const verdict = durableViewVerdict("never", UNRELIABLE);
  assert.equal(verdict.writes, false);
  assert.match(verdict.reason, /set to never/);
});

/**
 * hazard: the config is merged structurally and never validated. A project carrying the old boolean would have
 * matched no mode and fallen through to `auto`, turning an explicit `false` into a file its operator switched off.
 */
test("the legacy boolean keeps the behaviour its operator chose", () => {
  assert.deepEqual(resolveSyncMode(true), { mode: "always", coercedFrom: true });
  assert.deepEqual(resolveSyncMode(false), { mode: "never", coercedFrom: false });
});

test("a mode reads as itself and reports no coercion", () => {
  for (const mode of ["auto", "always", "never"] as const) {
    assert.deepEqual(resolveSyncMode(mode), { mode });
  }
});

// why: fail-soft, following appendFiles. A typo degrades to asking the host rather than to silence.
test("an unrecognised value degrades to auto", () => {
  assert.equal(lessonsSyncMode("alwyas"), "auto");
  assert.equal(lessonsSyncMode(undefined), "auto");
  assert.equal(lessonsSyncMode(0), "auto");
});

// invariant: the shipped default is the one that asks the host. A default of `never` would reproduce the defect.
test("the shipped default is auto", () => {
  assert.equal(DEFAULT_LESSONS_POLICY.syncRulesFile, "auto");
});
