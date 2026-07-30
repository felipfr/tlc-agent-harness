import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  clearGateReport,
  computeGateFingerprint,
  extractFindingsFromOutput,
  gateReportPath,
  readLastGate,
  readReportFindings,
  trimOutputTail,
  writeLastGate,
} from "../gate.artifact.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-gate-artifact-"));
}

test("extractFindingsFromOutput prefers FAIL/Error lines over passing noise", () => {
  const passNoise = Array.from({ length: 50 }, (_, i) => `✓ pass line ${i}`).join("\n");
  const failing = `${passNoise}\nFAIL src/x.spec.ts > does the thing\nError: expected 1 to be 2\n`;
  const findings = extractFindingsFromOutput(failing, 1);
  assert.ok(findings.some((f) => /FAIL|Error:/.test(f.summary)));
  assert.equal(
    findings.some((f) => f.summary.startsWith("✓ pass")),
    false,
  );
});

test("extractFindingsFromOutput on empty output reports the exit code", () => {
  const empty = extractFindingsFromOutput("", 7);
  assert.equal(empty[0]?.summary, "gate exited with code 7");
});

test("writeLastGate with a placeholder output falls back to the exit-code summary", () => {
  const root = tempRoot();
  try {
    const artifact = writeLastGate({
      root,
      gate: "test",
      exitCode: 3,
      command: ["false"],
      files: [],
      durationMs: 1,
      output: "(no output captured)",
    });
    assert.equal(artifact.findings[0]?.summary, "gate exited with code 3");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("trimOutputTail keeps the tail within the max and preserves the trailing marker", () => {
  const long = `${"a".repeat(9000)}TAIL_MARK`;
  const trimmed = trimOutputTail(long);
  assert.ok(trimmed.endsWith("TAIL_MARK"));
  assert.ok(trimmed.length <= 8000);
});

test("readReportFindings prefers the report file's own findings", () => {
  const root = tempRoot();
  try {
    const report = gateReportPath(root);
    mkdirSync(join(root, ".tlc", "harness", "state"), { recursive: true });
    writeFileSync(
      report,
      JSON.stringify({
        findings: [{ id: "t1", summary: "reported failure A" }, { summary: "reported failure B" }],
      }),
    );
    const findings = readReportFindings(report);
    assert.equal(findings?.[0]?.summary, "reported failure A");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("writeLastGate uses report findings over output-extracted ones", () => {
  const root = tempRoot();
  try {
    const report = gateReportPath(root);
    mkdirSync(join(root, ".tlc", "harness", "state"), { recursive: true });
    writeFileSync(report, JSON.stringify({ findings: [{ summary: "reported failure A" }] }));

    const artifact = writeLastGate({
      root,
      gate: "test",
      exitCode: 1,
      command: ["false"],
      files: ["src/a.ts"],
      durationMs: 12,
      output: "FAIL src/x.spec.ts\nError: nope\n",
      reportPath: report,
    });
    assert.equal(artifact.schema, "harness.gate.v1");
    assert.equal(artifact.passed, false);
    assert.equal(artifact.findings[0]?.summary, "reported failure A");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("readLastGate round-trips what writeLastGate wrote", () => {
  const root = tempRoot();
  try {
    writeLastGate({
      root,
      gate: "lint",
      exitCode: 0,
      command: ["biome", "check"],
      files: [],
      durationMs: 5,
      output: "",
    });
    const reloaded = readLastGate(root);
    assert.equal(reloaded?.gate, "lint");
    assert.equal(reloaded?.passed, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("computeGateFingerprint is order-independent across findings", () => {
  const root = tempRoot();
  try {
    const artifact = writeLastGate({
      root,
      gate: "test",
      exitCode: 1,
      command: ["false"],
      files: ["src/a.ts"],
      durationMs: 1,
      output: "FAIL a\nFAIL b\n",
    });
    const fp1 = computeGateFingerprint(artifact);
    const fp2 = computeGateFingerprint({ ...artifact, findings: [...artifact.findings].reverse() });
    assert.equal(fp1, fp2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("computeGateFingerprint differs when the findings differ", () => {
  const root = tempRoot();
  try {
    const artifact = writeLastGate({
      root,
      gate: "test",
      exitCode: 1,
      command: ["false"],
      files: [],
      durationMs: 1,
      output: "FAIL a\n",
    });
    const fp1 = computeGateFingerprint(artifact);
    const fp2 = computeGateFingerprint({ ...artifact, findings: [{ summary: "other" }] });
    assert.notEqual(fp1, fp2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("clearGateReport removes an existing report and is a no-op when absent", () => {
  const root = tempRoot();
  try {
    const report = gateReportPath(root);
    mkdirSync(join(root, ".tlc", "harness", "state"), { recursive: true });
    writeFileSync(report, "{}");
    clearGateReport(root);
    assert.equal(existsSync(report), false);
    assert.doesNotThrow(() => clearGateReport(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
