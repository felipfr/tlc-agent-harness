import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS } from "../policy.defaults.ts";
import { operatorBootstrapLines } from "../policy.operator.ts";
import { OPERATOR_MODES } from "../policy.posture.ts";
import type { OperatorMode, Policy } from "../policy.types.ts";

function policyAt(mode: OperatorMode, patch: Partial<Policy> = {}): Policy {
  return { ...DEFAULTS, ...patch, mode };
}

function linesAt(mode: OperatorMode): string[] {
  return operatorBootstrapLines(policyAt(mode), "/tmp/state");
}

function postureLine(mode: OperatorMode): string {
  const line = linesAt(mode).find((text) => text.startsWith("Posture "));
  assert.ok(line, `no posture line rendered at ${mode}`);
  return line;
}

test("every posture renders exactly one posture line", () => {
  for (const mode of OPERATOR_MODES) {
    const posture = linesAt(mode).filter((line) => line.startsWith("Posture "));
    assert.equal(posture.length, 1, `${mode} rendered ${posture.length} posture lines`);
  }
});

// hazard: this is the defect that shipped. The deepest posture had two spellings, so a config written from the
// documented word produced `BY_POSTURE[value] === undefined`, and `Array.join` swallowed it — the bootstrap went
// out with no posture line at all and nothing said so.
test("no posture renders an undefined line", () => {
  for (const mode of OPERATOR_MODES) {
    for (const line of linesAt(mode)) {
      assert.notEqual(line, undefined);
      assert.doesNotMatch(line, /undefined/);
    }
  }
});

// invariant: the guarantee an agent must not be able to misread. A quieter posture is not a weaker bar, and the
// harness states that itself rather than leaving it to be inferred from what the posture line omits.
test("every posture states that verification does not move with posture", () => {
  for (const mode of OPERATOR_MODES) {
    const stated = linesAt(mode).some(
      (line) => line.includes("Verification does not change with posture") && line.includes("every level"),
    );
    assert.ok(stated, `${mode} does not state the verification invariant`);
  }
});

// hazard: the threshold used to sit in the shared block as solo's, asserted for all three, and each posture line
// then contradicted it. A rule that varies cannot live in the block that does not vary.
test("the interruption threshold appears in the posture line and nowhere in the shared block", () => {
  for (const mode of OPERATOR_MODES) {
    const shared = linesAt(mode).filter((line) => !line.startsWith("Posture "));
    for (const line of shared) {
      assert.doesNotMatch(line, /Ask the owner only for/, mode);
      assert.doesNotMatch(line, /Surface exactly three things/, mode);
    }
  }
});

test("solo names the three stops, ambiguity included", () => {
  const line = postureLine("solo");
  assert.match(line, /irreversible or destructive/);
  assert.match(line, /dead-end/);
  assert.match(line, /ambiguity that changes the outcome/);
});

test("paired adds the pre-check on top of the three stops", () => {
  const line = postureLine("paired");
  assert.match(line, /check in before any sizable/);
  assert.match(line, /ambiguity that changes the outcome/);
});

// why: this is the sentence the old text lost entirely. At the deepest posture ambiguity is the agent's to
// settle, and `BASE` used to demand escalating it at every posture, which is why the posture never read as one.
test("focus drops the ambiguity stop and hands it to the agent under a stated assumption", () => {
  const line = postureLine("focus");
  assert.match(line, /irreversible or destructive/);
  assert.match(line, /dead-end/);
  assert.match(line, /ambiguity is yours to settle/);
  assert.match(line, /stating the assumption/);
});

// hazard: a threshold with no deadline licenses the worst case — asking at the twentieth action about a goal
// misread at the first. Measured: a late question is worse than no question, so every posture states when.
test("every posture states a deadline for ambiguity, not only a threshold", () => {
  for (const mode of OPERATOR_MODES) {
    const line = postureLine(mode);
    assert.match(line, /first actions|before you start/, mode);
  }
});

test("solo names the deadline and the fallback that replaces the question after it", () => {
  const line = postureLine("solo");
  assert.match(line, /unclear goal belongs in your first actions/);
  assert.match(line, /once the work is under way/);
  assert.match(line, /state the assumption/);
});

// why: `focus` is not "never ask" — it is ask early or not at all. One question before the first action is
// cheaper than everything built on a misreading, which is what the decay measurement shows.
test("focus admits exactly one early question and keeps settling everything after it", () => {
  const line = postureLine("focus");
  assert.match(line, /before you start/);
  assert.match(line, /ask that once/);
  assert.match(line, /ambiguity is yours to settle/);
});

// invariant: the harness cannot measure where in a trajectory it is, so it must not print a position. A
// percentage or a turn count here would be a number nothing computes — the AD-020 class, in prose.
test("no posture line states a percentage or a turn count", () => {
  for (const mode of OPERATOR_MODES) {
    assert.doesNotMatch(postureLine(mode), /\d/, mode);
  }
});

// invariant: posture governs surfacing. A posture line that names a gate or a config field is a posture that
// changes machinery — the old solo line named the ship gate and the old deepest line named grind.
test("no posture line names a gate, a capability or a config field", () => {
  for (const mode of OPERATOR_MODES) {
    const line = postureLine(mode);
    for (const machinery of [
      "grind",
      "shipGate",
      "ship gate",
      "codePaths",
      "planGate",
      "HARNESS_SHIP_CLAIM",
    ]) {
      assert.equal(line.includes(machinery), false, `${mode} names ${machinery}`);
    }
  }
});

// why: the postures must differ in the threshold and in nothing else, which is only observable by rendering all
// three against the same policy and diffing what is left.
test("the three bootstraps differ only in the posture line", () => {
  const withoutPosture = OPERATOR_MODES.map((mode) =>
    linesAt(mode).filter((line) => !line.startsWith("Posture ")),
  );
  for (const rendered of withoutPosture.slice(1)) {
    assert.deepEqual(rendered, withoutPosture[0]);
  }
  const postures = new Set(OPERATOR_MODES.map((mode) => postureLine(mode)));
  assert.equal(postures.size, OPERATOR_MODES.length, "two postures render the same threshold");
});

test("an enabled capability appends its own line without disturbing the posture line", () => {
  const lines = operatorBootstrapLines(
    policyAt("focus", { shipGate: { ...DEFAULTS.shipGate, enabled: true } }),
    "/tmp/state",
  );
  assert.ok(lines.some((line) => line.includes("HARNESS_SHIP_CLAIM")));
  assert.equal(lines.filter((line) => line.startsWith("Posture ")).length, 1);
});
