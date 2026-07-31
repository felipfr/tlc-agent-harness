import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { flagsDir, projectConfigPath, projectStateDir } from "../../../platform/paths.ts";
import {
  checkPolicyBaseline,
  policySourceFingerprint,
  recordPolicyBaseline,
  refreshPolicyBaselines,
} from "../policy.integrity.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function newRoot(config = '{"version":1}'): string {
  const root = mkdtempSync(join(tmpdir(), "tlc-integrity-"));
  roots.push(root);
  mkdirSync(join(root, ".tlc", "harness"), { recursive: true });
  mkdirSync(projectStateDir(root), { recursive: true });
  writeFileSync(projectConfigPath(root), config, "utf8");
  return root;
}

test("a missing baseline is recorded and allowed, never blocked", () => {
  const root = newRoot();
  assert.equal(checkPolicyBaseline(root, "s1").kind, "allow");
  // why: the first hook of every session lands here; blocking would break every fresh session.
  assert.equal(checkPolicyBaseline(root, "s1").kind, "allow");
});

test("an unchanged policy is allowed", () => {
  const root = newRoot();
  recordPolicyBaseline(root, "s1");
  assert.equal(checkPolicyBaseline(root, "s1").kind, "allow");
});

test("an out-of-band config change is denied and names the file", () => {
  const root = newRoot();
  recordPolicyBaseline(root, "s1");
  writeFileSync(projectConfigPath(root), '{"version":1,"grind":{"enabled":false}}', "utf8");

  const decision = checkPolicyBaseline(root, "s1");
  assert.equal(decision.kind, "deny");
  if (decision.kind === "deny") {
    assert.match(decision.reason, /changed during this session/);
    assert.ok(decision.reason.includes(projectConfigPath(root)));
  }
});

test("creating a flag file out of band is denied", () => {
  // why: `skip-verify` disables the stop checks without the config file being touched at all.
  const root = newRoot();
  recordPolicyBaseline(root, "s1");
  mkdirSync(flagsDir(root), { recursive: true });
  writeFileSync(join(flagsDir(root), "skip-verify"), "", "utf8");

  assert.equal(checkPolicyBaseline(root, "s1").kind, "deny");
});

test("writing the mode file out of band is denied", () => {
  const root = newRoot();
  recordPolicyBaseline(root, "s1");
  writeFileSync(join(projectStateDir(root), "harness-mode"), "solo", "utf8");

  assert.equal(checkPolicyBaseline(root, "s1").kind, "deny");
});

test("deleting the config is a divergence, not an unchanged reading", () => {
  const root = newRoot();
  recordPolicyBaseline(root, "s1");
  rmSync(projectConfigPath(root));

  assert.equal(checkPolicyBaseline(root, "s1").kind, "deny");
});

test("refreshing the baselines clears the block, which is how a harness command reports itself", () => {
  const root = newRoot();
  recordPolicyBaseline(root, "s1");
  writeFileSync(projectConfigPath(root), '{"version":1,"mode":"solo"}', "utf8");
  assert.equal(checkPolicyBaseline(root, "s1").kind, "deny");

  refreshPolicyBaselines(root);
  assert.equal(checkPolicyBaseline(root, "s1").kind, "allow");
});

test("refresh reaches every live session, because the CLI cannot know which are live", () => {
  const root = newRoot();
  recordPolicyBaseline(root, "s1");
  recordPolicyBaseline(root, "s2");
  writeFileSync(projectConfigPath(root), '{"version":1,"mode":"paired"}', "utf8");

  refreshPolicyBaselines(root);
  assert.equal(checkPolicyBaseline(root, "s1").kind, "allow");
  assert.equal(checkPolicyBaseline(root, "s2").kind, "allow");
});

test("sessions keep independent baselines", () => {
  const root = newRoot();
  recordPolicyBaseline(root, "s1");
  writeFileSync(projectConfigPath(root), '{"version":2}', "utf8");
  // why: s2 starts after the change, so the change is its baseline — an operator edit between sessions is
  // the operator's prerogative and must not surface as tampering.
  recordPolicyBaseline(root, "s2");

  assert.equal(checkPolicyBaseline(root, "s1").kind, "deny");
  assert.equal(checkPolicyBaseline(root, "s2").kind, "allow");
});

test("a session key that is not a safe filename still works", () => {
  const root = newRoot();
  recordPolicyBaseline(root, "provider/../weird key");
  assert.equal(checkPolicyBaseline(root, "provider/../weird key").kind, "allow");
  writeFileSync(projectConfigPath(root), "{}", "utf8");
  assert.equal(checkPolicyBaseline(root, "provider/../weird key").kind, "deny");
});

test("a missing config file hashes as absent rather than throwing", () => {
  const root = mkdtempSync(join(tmpdir(), "tlc-integrity-"));
  roots.push(root);
  const sources = policySourceFingerprint(root);
  assert.ok(sources.length >= 3);
  assert.ok(sources.every((source) => typeof source.hash === "string" && source.hash.length > 0));
  assert.equal(sources[0]?.hash, "absent");
});

test("the fingerprint covers every source the loader reads", () => {
  const root = newRoot();
  const paths = policySourceFingerprint(root).map((source) => source.path);
  assert.ok(paths.includes(projectConfigPath(root)));
  assert.ok(paths.includes(join(projectStateDir(root), "harness-mode")));
  for (const flag of ["grind-on", "skip-verify", "heads-down", "paired"]) {
    assert.ok(paths.includes(join(flagsDir(root), flag)), flag);
  }
});
