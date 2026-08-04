import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  type AttestationRecord,
  appendAttestation,
  attestationPath,
  CHAIN_ROOT,
  fingerprintOf,
  readAttestations,
  verifyChain,
} from "../attest.service.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-attest-"));
}

function body(session: string): Omit<AttestationRecord, "schema" | "prev" | "self"> {
  return {
    ts: `2026-08-04T00:00:0${session}Z`,
    provider: "provider-a",
    session,
    policyFingerprint: "abc123",
    policyDiverged: false,
    railsActive: ["grind", "shell-catastrophic"],
    decisionsByRule: { "shell-catastrophic": 1 },
    gates: { pass: 2, fail: 0 },
  };
}

test("the first record chains from the empty-chain marker", () => {
  const root = tempRoot();
  try {
    assert.equal(appendAttestation(root, body("1")).prev, CHAIN_ROOT);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("each record chains from the previous one, and three verify", () => {
  const root = tempRoot();
  try {
    const first = appendAttestation(root, body("1"));
    const second = appendAttestation(root, body("2"));
    assert.equal(second.prev, first.self);
    appendAttestation(root, body("3"));
    assert.deepEqual(verifyChain(readAttestations(root)), { ok: true, length: 3 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// why: reports the index rather than a bare boolean. "The chain is broken" sends a reviewer to read the whole file;
// "record 1 does not match its own content" sends them to one line.
test("rewriting the middle record is detected, and the index is named", () => {
  const root = tempRoot();
  try {
    appendAttestation(root, body("1"));
    appendAttestation(root, body("2"));
    appendAttestation(root, body("3"));

    const rows = readFileSync(attestationPath(root), "utf8").trimEnd().split("\n");
    const tampered = JSON.parse(rows[1] as string) as AttestationRecord;
    tampered.gates = { pass: 99, fail: 0 };
    rows[1] = JSON.stringify(tampered);
    writeFileSync(attestationPath(root), `${rows.join("\n")}\n`);

    const verdict = verifyChain(readAttestations(root));
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.equal(verdict.brokenAt, 1);
      assert.equal(verdict.reason, "content-hash-mismatch");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("removing a record breaks the link and names the record that lost its parent", () => {
  const root = tempRoot();
  try {
    appendAttestation(root, body("1"));
    appendAttestation(root, body("2"));
    appendAttestation(root, body("3"));
    const rows = readFileSync(attestationPath(root), "utf8").trimEnd().split("\n");
    writeFileSync(attestationPath(root), `${[rows[0], rows[2]].join("\n")}\n`);

    const verdict = verifyChain(readAttestations(root));
    assert.equal(verdict.ok, false);
    if (!verdict.ok) {
      assert.equal(verdict.brokenAt, 1);
      assert.equal(verdict.reason, "previous-hash-mismatch");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// invariant: a repository that never attested has nothing to have tampered with. Reporting that as broken would
// train a reviewer to ignore the check.
test("an absent file is an empty valid chain, not a broken one", () => {
  const root = tempRoot();
  try {
    assert.deepEqual(verifyChain(readAttestations(root)), { ok: true, length: 0 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// invariant: every field is observed. An attestation implying correctness or human approval would be worse than
// none, because a reviewer would stop looking.
test("the record claims nothing the harness cannot see", () => {
  const root = tempRoot();
  try {
    const record = appendAttestation(root, body("1"));
    const keys = Object.keys(record).sort();
    assert.deepEqual(keys, [
      "decisionsByRule",
      "gates",
      "policyDiverged",
      "policyFingerprint",
      "prev",
      "provider",
      "railsActive",
      "schema",
      "self",
      "session",
      "ts",
    ]);
    for (const forbidden of ["approved", "reviewed", "correct", "signed", "verifiedBy"]) {
      assert.equal(keys.includes(forbidden), false, forbidden);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the policy fingerprint is order-independent, so source order cannot change it", () => {
  const a = [
    { path: "b.json", hash: "2" },
    { path: "a.json", hash: "1" },
  ];
  const b = [
    { path: "a.json", hash: "1" },
    { path: "b.json", hash: "2" },
  ];
  assert.equal(fingerprintOf(a), fingerprintOf(b));
});

test("a changed policy source changes the fingerprint", () => {
  const before = fingerprintOf([{ path: "a.json", hash: "1" }]);
  const after = fingerprintOf([{ path: "a.json", hash: "2" }]);
  assert.notEqual(before, after);
});
