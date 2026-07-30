import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { detectDeviations, detectPlan } from "../plan.detect.ts";
import { evaluatePlanGate, planActive, unplannedPaths } from "../plan.service.ts";

const NOW = Date.parse("2026-07-30T12:00:00.000Z");
const FRESH = "2026-07-30T11:30:00.000Z";
const STALE = "2026-07-30T06:00:00.000Z";

describe("detectPlan", () => {
  test("reads a comma-separated declaration", () => {
    const plan = detectPlan("HARNESS_PLAN: src/a.ts, src/b.ts");
    assert.deepEqual(plan?.paths, ["src/a.ts", "src/b.ts"]);
    assert.equal(plan?.snippet, "HARNESS_PLAN: src/a.ts, src/b.ts");
  });

  test("reads a whitespace-separated declaration and one embedded in prose", () => {
    assert.deepEqual(detectPlan("HARNESS_PLAN: src/a.ts src/b.ts")?.paths, ["src/a.ts", "src/b.ts"]);
    assert.deepEqual(
      detectPlan("Here is what I will touch.\nHARNESS_PLAN: src/a.ts\nThen I will run the tests.")?.paths,
      ["src/a.ts"],
    );
  });

  test("free-form prose about plans is ignored", () => {
    assert.equal(detectPlan("my plan is to change src/a.ts and src/b.ts"), null);
    assert.equal(detectPlan(""), null);
  });

  // hazard: an empty declaration must not read as "nothing is planned" — that would make every changed file
  // unplanned and block the turn on a typo.
  test("an empty declaration is malformed, not an empty plan", () => {
    assert.equal(detectPlan("HARNESS_PLAN:"), null);
    assert.equal(detectPlan("HARNESS_PLAN:    "), null);
  });

  test("a glob survives intact, since the matcher accepts it", () => {
    assert.deepEqual(detectPlan("HARNESS_PLAN: src/core/**, docs/*.md")?.paths, ["src/core/**", "docs/*.md"]);
  });
});

describe("detectDeviations", () => {
  test("reads a path and its reason", () => {
    assert.deepEqual(
      detectDeviations("HARNESS_PLAN_DEVIATION: src/c.ts — the type moved with the call site"),
      [{ path: "src/c.ts", reason: "the type moved with the call site" }],
    );
  });

  test("reads several, and accepts a plain hyphen as the separator", () => {
    const found = detectDeviations(
      ["HARNESS_PLAN_DEVIATION: a.ts - first reason", "HARNESS_PLAN_DEVIATION: b.ts -- second reason"].join(
        "\n",
      ),
    );
    assert.deepEqual(
      found.map((deviation) => deviation.path),
      ["a.ts", "b.ts"],
    );
  });

  // hazard: naming the file without saying why is not a justification.
  test("a path with no reason is refused", () => {
    assert.deepEqual(detectDeviations("HARNESS_PLAN_DEVIATION: src/c.ts"), []);
    assert.deepEqual(detectDeviations("HARNESS_PLAN_DEVIATION: src/c.ts —"), []);
  });

  test("no deviation lines yields an empty list", () => {
    assert.deepEqual(detectDeviations("nothing here"), []);
  });
});

describe("planActive", () => {
  test("a fresh declaration is active and a stale one is not", () => {
    assert.equal(planActive(FRESH, 120, NOW), true);
    assert.equal(planActive(STALE, 120, NOW), false);
  });

  test("an absent or unparseable timestamp is not active", () => {
    assert.equal(planActive(undefined, 120, NOW), false);
    assert.equal(planActive("not a date", 120, NOW), false);
  });
});

describe("unplannedPaths", () => {
  test("an exactly planned file is planned", () => {
    assert.deepEqual(
      unplannedPaths({ changedFiles: ["src/a.ts"], planned: ["src/a.ts"], deviations: [] }),
      [],
    );
  });

  test("a glob covers the files under it", () => {
    assert.deepEqual(
      unplannedPaths({
        changedFiles: ["src/core/x.ts", "src/core/y.ts"],
        planned: ["src/core/**"],
        deviations: [],
      }),
      [],
    );
  });

  test("a file outside the plan is reported", () => {
    assert.deepEqual(
      unplannedPaths({ changedFiles: ["src/a.ts", "src/b.ts"], planned: ["src/a.ts"], deviations: [] }),
      ["src/b.ts"],
    );
  });

  test("a justified file is no longer reported", () => {
    assert.deepEqual(
      unplannedPaths({
        changedFiles: ["src/a.ts", "src/b.ts"],
        planned: ["src/a.ts"],
        deviations: [{ path: "src/b.ts", reason: "the call site moved" }],
      }),
      [],
    );
  });

  test("a justification for one file does not cover another", () => {
    assert.deepEqual(
      unplannedPaths({
        changedFiles: ["src/b.ts", "src/c.ts"],
        planned: [],
        deviations: [{ path: "src/b.ts", reason: "stated" }],
      }),
      ["src/c.ts"],
    );
  });
});

describe("evaluatePlanGate", () => {
  const base = {
    enabled: true,
    declaredAt: FRESH,
    windowMinutes: 120,
    planned: ["src/a.ts"],
    deviations: [],
    now: NOW,
  };

  test("abstains when the rail is off", () => {
    const decision = evaluatePlanGate({ ...base, enabled: false, changedFiles: ["src/b.ts"] });
    assert.equal(decision.kind, "abstain");
  });

  test("abstains when no plan was declared", () => {
    const decision = evaluatePlanGate({ ...base, planned: [], changedFiles: ["src/b.ts"] });
    assert.equal(decision.kind, "abstain");
  });

  test("abstains once the plan's window has passed, so a stale plan cannot block a later turn", () => {
    const decision = evaluatePlanGate({ ...base, declaredAt: STALE, changedFiles: ["src/b.ts"] });
    assert.equal(decision.kind, "abstain");
  });

  test("abstains when every changed file is planned", () => {
    const decision = evaluatePlanGate({ ...base, changedFiles: ["src/a.ts"] });
    assert.equal(decision.kind, "abstain");
  });

  test("blocks and names the unplanned files plus the escape hatch", () => {
    const decision = evaluatePlanGate({ ...base, changedFiles: ["src/a.ts", "src/b.ts"] });
    assert.equal(decision.kind, "continue");
    if (decision.kind === "continue") {
      assert.match(decision.text, /^BLOCKED:/);
      assert.match(decision.text, /src\/b\.ts/);
      assert.match(decision.text, /TRIED:/);
      assert.match(decision.text, /NEED:/);
      assert.match(decision.text, /HARNESS_PLAN_DEVIATION/);
    }
  });

  test("a justified deviation clears the block", () => {
    const decision = evaluatePlanGate({
      ...base,
      changedFiles: ["src/a.ts", "src/b.ts"],
      deviations: [{ path: "src/b.ts", reason: "the call site moved" }],
    });
    assert.equal(decision.kind, "abstain");
  });

  test("a long list is truncated with a count rather than printed whole", () => {
    const changedFiles = Array.from({ length: 15 }, (_, index) => `src/f${index}.ts`);
    const decision = evaluatePlanGate({ ...base, changedFiles });
    assert.equal(decision.kind, "continue");
    if (decision.kind === "continue") {
      assert.match(decision.text, /\(\+5 more\)/);
    }
  });

  test("an empty working tree cannot violate a plan", () => {
    assert.equal(evaluatePlanGate({ ...base, changedFiles: [] }).kind, "abstain");
  });
});
