import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { coreFacade } from "../core.facade.ts";
import * as coreIndex from "../index.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-core-facade-"));
}

test("core/index.ts exports only the facade at runtime — no store or service is reachable", () => {
  assert.deepEqual(Object.keys(coreIndex), ["coreFacade"]);
});

test("facade.gate.computeGateFingerprint is deterministic, mirroring the underlying aggregate", () => {
  const root = tempRoot();
  try {
    const artifact = coreFacade.gate.writeLastGate({
      root,
      gate: "test",
      exitCode: 1,
      command: ["npm", "test"],
      files: ["a.ts"],
      durationMs: 5,
      output: "FAIL",
    });
    assert.equal(
      coreFacade.gate.computeGateFingerprint(artifact),
      coreFacade.gate.computeGateFingerprint(artifact),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("facade.stagnation tracks and clears fingerprint hits per session", () => {
  const root = tempRoot();
  try {
    coreFacade.stagnation.trackFingerprint(root, "session-a", "fp-1");
    coreFacade.stagnation.trackFingerprint(root, "session-a", "fp-1");
    assert.equal(coreFacade.stagnation.fingerprintHits(root, "session-a"), 2);
    coreFacade.stagnation.clearFingerprint(root, "session-a");
    assert.equal(coreFacade.stagnation.fingerprintHits(root, "session-a"), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("facade.handoff round-trips a provider slice", async () => {
  const root = tempRoot();
  try {
    await coreFacade.handoff.patchHandoff(root, "provider-a", { slice: { next_action: "run tests" } });
    const resolved = coreFacade.handoff.readHandoff(root, "provider-a");
    assert.equal(resolved.next_action, "run tests");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("facade.lesson.selectLessons is properly awaited and resolves to a real lesson list, not a pending Promise", async () => {
  const root = tempRoot();
  const config = {
    enabled: true,
    maxInjectSession: 5,
    maxInjectRetry: 8,
    maxCharsSession: 900,
    maxCharsRetry: 1400,
    promoteHitCount: 2,
    decayLambda: 0.02,
    projectBoost: 1.5,
    syncRulesFile: false,
    gardenOnSessionEnd: true,
  };
  try {
    const pending = coreFacade.lesson.selectLessons({ projectDir: root, config, mode: "session" });
    assert.equal(typeof pending.then, "function");
    const result = await pending;
    assert.ok(Array.isArray(result.lessons));
    assert.ok(Array.isArray(result.usedIds));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("facade.policy.loadPolicy resolves defaults for a project with no config", () => {
  const root = tempRoot();
  try {
    const policy = coreFacade.policy.loadPolicy(root);
    assert.equal(policy.mode, "solo");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("facade.shellPolicy.evaluateShellCommand asks on a catastrophic command", () => {
  const decision = coreFacade.shellPolicy.evaluateShellCommand({
    command: "rm -rf /",
    mode: "solo" as const,
    sessionKey: "session-a",
    projectDir: "",
    catastrophicAsk: true,
    stallDetection: false,
    stallRepeatThreshold: 3,
  });
  assert.equal(decision.kind, "ask");
});

test("facade.subagentPolicy.evaluateSubagentSpawn denies a blocked model", () => {
  const decision = coreFacade.subagentPolicy.evaluateSubagentSpawn({
    provider: "provider-a",
    sessionKey: "session-a",
    projectDir: "",
    model: "provider-a-model[fast=true]",
    allowedModels: [],
    blockedPatterns: [],
    minEffort: null,
    requireModel: false,
    enforceAllowlist: false,
    blockParentFast: false,
  });
  assert.equal(decision.kind, "deny");
});

test("facade.commentPolicy.isCommentLine is reachable and deterministic", () => {
  const root = tempRoot();
  try {
    assert.equal(coreFacade.commentPolicy.isCommentLine("// x"), true);
    assert.equal(coreFacade.commentPolicy.isCommentLine("const a = 1;"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("facade.ship.detectShipClaim only fires on the structured marker", () => {
  assert.equal(coreFacade.ship.detectShipClaim("all done, shipped it"), null);
  assert.ok(coreFacade.ship.detectShipClaim("HARNESS_SHIP_CLAIM: evidence attached"));
});

test("facade.presence.register and checkCollision compose correctly", () => {
  const root = tempRoot();
  try {
    coreFacade.presence.register(root, {
      provider: "provider-a",
      session: "session-a",
      pid: 1,
      branch: "main",
    });
    coreFacade.presence.heartbeat(root, { provider: "provider-a", session: "session-a", file: "src/x.ts" });
    const decision = coreFacade.presence.checkCollision(root, "src/x.ts", "provider-b-session-b");
    assert.equal(decision.kind, "ask");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("facade.turn.resolveAutopilot composes with formatAutopilotBlock", () => {
  const plan = coreFacade.turn.resolveAutopilot({
    category: "verification",
    gate: "test",
    mode: "solo",
    loopCount: 0,
    maxLoops: 5,
  });
  const block = coreFacade.turn.formatAutopilotBlock(plan);
  assert.match(block, /AUTOPILOT/);
});

// hazard: the plan used to print `Focus files: <changed files>` under a category whose steps say "fix each item
// explicitly". Measured naming a file no test imports while the gate output named the three real ones — an
// instruction to go edit innocent code, which is the AD-021 harm through a different door.
test("the plan names the files the failure points at, not the ones that changed", () => {
  const plan = coreFacade.turn.resolveAutopilot({
    category: "verification",
    gate: "test",
    mode: "solo",
    loopCount: 0,
    maxLoops: 5,
    failingFiles: ["src/entrypoints/__test__/tool-before.test.ts"],
    changedFiles: ["src/core/policy/policy.posture.ts"],
  });
  const block = coreFacade.turn.formatAutopilotBlock(plan);

  assert.match(block, /tool-before\.test\.ts/);
  assert.doesNotMatch(block, /policy\.posture\.ts/);
  assert.doesNotMatch(block, /Focus files/);
});

test("with no evidence the changed files are offered as what they are", () => {
  const plan = coreFacade.turn.resolveAutopilot({
    category: "verification",
    gate: "test",
    mode: "solo",
    loopCount: 0,
    maxLoops: 5,
    failingFiles: [],
    changedFiles: ["src/a.ts"],
  });
  const block = coreFacade.turn.formatAutopilotBlock(plan);

  assert.match(block, /src\/a\.ts/);
  // why: the wording has to say it came from the diff, so it is not read as the cause.
  assert.match(block, /from the diff/);
  assert.doesNotMatch(block, /Focus files/);
});

test("with neither list no file line is emitted", () => {
  const plan = coreFacade.turn.resolveAutopilot({
    category: "verification",
    gate: "test",
    mode: "solo",
    loopCount: 0,
    maxLoops: 5,
  });
  const block = coreFacade.turn.formatAutopilotBlock(plan);

  // why: asserts the absence of a file *list*, not of the word. The standing fallback step still tells the
  // agent to re-run against the changed files the gate used, which is guidance rather than an accusation.
  assert.doesNotMatch(block, /Failing files/);
  assert.doesNotMatch(block, /Files the gate ran/);
});
