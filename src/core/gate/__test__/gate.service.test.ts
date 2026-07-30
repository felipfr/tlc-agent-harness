import assert from "node:assert/strict";
import { test } from "node:test";
import { gapsFromArtifact } from "../gate.service.ts";
import type { LastGateArtifact } from "../gate.types.ts";

function artifact(overrides: Partial<LastGateArtifact> = {}): LastGateArtifact {
  return {
    schema: "harness.gate.v1",
    gate: "test",
    exitCode: 1,
    passed: false,
    command: ["false"],
    files: [],
    durationMs: 1,
    ts: new Date().toISOString(),
    outputTail: "",
    findings: [],
    ...overrides,
  };
}

test("gapsFromArtifact falls back to one gap naming the exit code when there are no findings", () => {
  const gaps = gapsFromArtifact({ artifact: artifact(), category: "verification" });
  assert.equal(gaps.length, 1);
  assert.match(gaps[0]?.summary ?? "", /exit 1/);
});

test("gapsFromArtifact maps each finding to a gap carrying the given category", () => {
  const gaps = gapsFromArtifact({
    artifact: artifact({ findings: [{ summary: "finding A" }, { summary: "finding B" }] }),
    category: "verification",
  });
  assert.equal(gaps.length, 2);
  assert.ok(gaps.every((g) => g.category === "verification"));
  assert.equal(gaps[0]?.summary, "finding A");
});

test("gapsFromArtifact respects the max limit", () => {
  const gaps = gapsFromArtifact({
    artifact: artifact({ findings: [{ summary: "a" }, { summary: "b" }, { summary: "c" }] }),
    category: "verification",
    max: 2,
  });
  assert.equal(gaps.length, 2);
});
