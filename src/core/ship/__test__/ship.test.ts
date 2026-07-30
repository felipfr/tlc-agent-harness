import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULTS } from "../../policy/policy.defaults.ts";
import { appendShipLedger, hasRecentEvidence, readShipLedger } from "../ship.ledger.ts";
import {
  detectShipClaim,
  evaluateEmptyDiffAntiShip,
  evaluateShipEvidenceGate,
  pathExcluded,
  recentShipClaimActive,
  touchesRuntime,
} from "../ship.service.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-ship-"));
}

test("detectShipClaim ignores free-English done/shipped language", () => {
  assert.equal(detectShipClaim("Task is done and complete, all fixed."), null);
  assert.equal(detectShipClaim("Ready to merge after review."), null);
  assert.equal(detectShipClaim("shipped to production yesterday."), null);
});

test("detectShipClaim only fires on the HARNESS_SHIP_CLAIM: marker", () => {
  const claim = detectShipClaim("Work finished.\nHARNESS_SHIP_CLAIM: release evidence PASS\nThanks.");
  assert.ok(claim);
  assert.equal(claim?.kind, "structured");
  assert.match(claim?.snippet ?? "", /^HARNESS_SHIP_CLAIM: release evidence/);
});

test("pathExcluded matches a directory-prefix exclude", () => {
  assert.equal(pathExcluded("vendor/cache/tmp.bin", ["vendor/"]), true);
});

test("pathExcluded matches a literal-directory exclude under .tlc/", () => {
  assert.equal(pathExcluded(".tlc/harness/config.json", [".tlc/"]), true);
});

test("pathExcluded is false when nothing matches", () => {
  assert.equal(pathExcluded("src/app.ts", [".tlc/", "vendor/"]), false);
});

test("touchesRuntime is false for an excluded path", () => {
  assert.equal(
    touchesRuntime(
      ["vendor/cache/tmp.bin"],
      DEFAULTS.shipGate.runtimePathPrefixes,
      DEFAULTS.shipGate.runtimePathExcludes,
    ),
    false,
  );
});

test("touchesRuntime is true for a src path", () => {
  assert.equal(
    touchesRuntime(
      ["src/app.ts"],
      DEFAULTS.shipGate.runtimePathPrefixes,
      DEFAULTS.shipGate.runtimePathExcludes,
    ),
    true,
  );
});

test("touchesRuntime is true for a scripts path", () => {
  assert.equal(
    touchesRuntime(
      ["scripts/release.ts"],
      DEFAULTS.shipGate.runtimePathPrefixes,
      DEFAULTS.shipGate.runtimePathExcludes,
    ),
    true,
  );
});

test("the default excludes name .tlc/, and touchesRuntime honors it as the harness's own state path", () => {
  assert.ok(DEFAULTS.shipGate.runtimePathExcludes.includes(".tlc/"));
  assert.equal(
    touchesRuntime(
      [".tlc/harness/state/last-gate.json"],
      DEFAULTS.shipGate.runtimePathPrefixes,
      DEFAULTS.shipGate.runtimePathExcludes,
    ),
    false,
  );
});

test("hasRecentEvidence is true for a fresh PASS verdict", () => {
  const dir = tempRoot();
  try {
    const evidence = join(dir, "evidence");
    const run = join(evidence, "run1");
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, "90-verdict.txt"), "PASS\ndelivery=path-A\n");
    assert.equal(hasRecentEvidence(evidence, 48), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hasRecentEvidence is false for a FAIL verdict", () => {
  const dir = tempRoot();
  try {
    const evidence = join(dir, "evidence");
    const run = join(evidence, "run1");
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, "90-verdict.txt"), "FAIL\n");
    assert.equal(hasRecentEvidence(evidence, 48), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hasRecentEvidence is false when the evidence directory does not exist", () => {
  const dir = tempRoot();
  try {
    assert.equal(hasRecentEvidence(join(dir, "no-such-dir"), 48), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recentShipClaimActive is true inside the claim window", () => {
  const now = Date.parse("2026-07-29T10:10:00.000Z");
  assert.equal(recentShipClaimActive("2026-07-29T10:05:00.000Z", 10, now), true);
});

test("recentShipClaimActive is false outside the claim window or with no timestamp", () => {
  const now = Date.parse("2026-07-29T10:20:00.000Z");
  assert.equal(recentShipClaimActive("2026-07-29T10:05:00.000Z", 10, now), false);
  assert.equal(recentShipClaimActive(undefined, 10, now), false);
});

test("appendShipLedger records the provider on every row", () => {
  const root = tempRoot();
  try {
    appendShipLedger(root, { provider: "provider-a", event: "claim", claimKind: "structured" });
    const rows = readShipLedger(root);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.provider, "provider-a");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("ledger rows record claim, challenge, and pass events distinctly", () => {
  const root = tempRoot();
  try {
    appendShipLedger(root, { provider: "provider-a", event: "claim", claimKind: "structured" });
    appendShipLedger(root, { provider: "provider-a", event: "challenge", gate: "ship" });
    appendShipLedger(root, { provider: "provider-b", event: "pass", gate: "ship" });
    const rows = readShipLedger(root);
    assert.deepEqual(
      rows.map((r) => r.event),
      ["claim", "challenge", "pass"],
    );
    assert.equal(rows[2]?.provider, "provider-b");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("evaluateEmptyDiffAntiShip continues the turn when enabled, claimed, and the diff is empty", () => {
  const decision = evaluateEmptyDiffAntiShip({ enabled: true, recentShipClaim: true, changedFilesCount: 0 });
  assert.equal(decision.kind, "continue");
});

test("evaluateEmptyDiffAntiShip abstains when the diff is not empty", () => {
  const decision = evaluateEmptyDiffAntiShip({ enabled: true, recentShipClaim: true, changedFilesCount: 3 });
  assert.equal(decision.kind, "abstain");
});

test("evaluateEmptyDiffAntiShip abstains when the gate is disabled", () => {
  const decision = evaluateEmptyDiffAntiShip({ enabled: false, recentShipClaim: true, changedFilesCount: 0 });
  assert.equal(decision.kind, "abstain");
});

test("evaluateShipEvidenceGate continues the turn when runtime files changed without recent evidence", () => {
  const decision = evaluateShipEvidenceGate({
    enabled: true,
    recentShipClaim: true,
    changedFiles: ["src/app.ts"],
    runtimePathPrefixes: DEFAULTS.shipGate.runtimePathPrefixes,
    runtimePathExcludes: DEFAULTS.shipGate.runtimePathExcludes,
    evidenceDir: null,
    evidenceMaxAgeHours: 48,
  });
  assert.equal(decision.kind, "continue");
});

test("evaluateShipEvidenceGate abstains when recent evidence exists", () => {
  const dir = tempRoot();
  try {
    const evidence = join(dir, "evidence");
    mkdirSync(join(evidence, "run1"), { recursive: true });
    writeFileSync(join(evidence, "run1", "90-verdict.txt"), "PASS\n");
    const decision = evaluateShipEvidenceGate({
      enabled: true,
      recentShipClaim: true,
      changedFiles: ["src/app.ts"],
      runtimePathPrefixes: DEFAULTS.shipGate.runtimePathPrefixes,
      runtimePathExcludes: DEFAULTS.shipGate.runtimePathExcludes,
      evidenceDir: evidence,
      evidenceMaxAgeHours: 48,
    });
    assert.equal(decision.kind, "abstain");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("evaluateShipEvidenceGate abstains when the changed files never touch runtime paths", () => {
  const decision = evaluateShipEvidenceGate({
    enabled: true,
    recentShipClaim: true,
    changedFiles: ["docs/readme.md"],
    runtimePathPrefixes: DEFAULTS.shipGate.runtimePathPrefixes,
    runtimePathExcludes: DEFAULTS.shipGate.runtimePathExcludes,
    evidenceDir: null,
    evidenceMaxAgeHours: 48,
  });
  assert.equal(decision.kind, "abstain");
});
