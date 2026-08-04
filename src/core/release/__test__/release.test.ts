import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  allDecisionFiles,
  type DecisionSummary,
  decisionsDir,
  formatDecisionDigest,
  needsAction,
  readDecision,
  readDecisions,
} from "../release.decisions.ts";
import { readReleaseSeen, writeReleaseSeen } from "../release.seen.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-release-"));
}

function writeDecision(root: string, file: string, fields: Record<string, string>): void {
  const path = join(decisionsDir(root), file);
  mkdirSync(dirname(path), { recursive: true });
  const front = Object.entries(fields)
    .map(([key, value]) => `${key}: "${value}"`)
    .join("\n");
  writeFileSync(
    path,
    `---\ntype: Decision\n${front}\ntags: [decision]\ntimestamp: "2026-08-04"\n---\n\n# body\n`,
  );
}

test("a decision without a migration note is read as needing no action", () => {
  const root = tempRoot();
  try {
    writeDecision(root, "ad-001.md", { title: "AD-001 — Something", description: "d" });
    const decision = readDecision(root, "ad-001.md");
    assert.equal(decision?.id, "AD-001");
    assert.equal(decision?.migration, undefined);
    assert.deepEqual(needsAction([decision as DecisionSummary]), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// why: the note is what marks a decision as needing operator action. Anything finer would be the harness guessing
// whether a given config is affected, which `doctor` answers precisely.
test("a decision with a migration note is read as needing action, carrying its text", () => {
  const root = tempRoot();
  try {
    writeDecision(root, "ad-002.md", {
      title: "AD-002 — Broke a thing",
      description: "d",
      migration: "Change X to Y.",
    });
    const decision = readDecision(root, "ad-002.md") as DecisionSummary;
    assert.equal(decision.migration, "Change X to Y.");
    assert.deepEqual(needsAction([decision]), [decision]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing file and a file with no title are both absent rather than throwing", () => {
  const root = tempRoot();
  try {
    assert.equal(readDecision(root, "ad-404.md"), null);
    const path = join(decisionsDir(root), "ad-003.md");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "no frontmatter here\n");
    assert.equal(readDecision(root, "ad-003.md"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// why: an absent docs directory is an empty list. A linked checkout may carry no docs at all, and that is not a fault.
test("an absent decisions directory yields no files and no decisions", () => {
  const root = tempRoot();
  try {
    assert.deepEqual(allDecisionFiles(root), []);
    assert.deepEqual(readDecisions(root, ["ad-001.md"]), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("only ad-NNN files count, so an index or a note is never announced as a decision", () => {
  const root = tempRoot();
  try {
    writeDecision(root, "ad-001.md", { title: "AD-001 — One", description: "d" });
    const index = join(decisionsDir(root), "index.md");
    writeFileSync(index, '---\ntype: Concept\ntitle: "Index"\n---\n');
    assert.deepEqual(allDecisionFiles(root), ["ad-001.md"]);
    assert.deepEqual(
      readDecisions(root, ["ad-001.md", "index.md", "log.md"]).map((d) => d.id),
      ["AD-001"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// invariant: needs-action comes first and carries the note. A note the operator scrolls past is a note that did not
// arrive.
test("the digest puts what needs action first, with its instruction", () => {
  const digest = formatDecisionDigest([
    { id: "AD-001", title: "AD-001 — Quiet one" },
    { id: "AD-002", title: "AD-002 — Loud one", migration: "Run the thing." },
  ]);
  assert.match(digest, /NEEDS YOUR ACTION \(1\)/);
  assert.ok(digest.indexOf("Loud one") < digest.indexOf("Quiet one"), "the actionable one must come first");
  assert.match(digest, /→ Run the thing\./);
  assert.match(digest, /No action needed/);
});

test("a digest with nothing in it is empty, so an update with no decisions prints nothing", () => {
  assert.equal(formatDecisionDigest([]), "");
});

test("a digest where nothing needs action omits the action heading entirely", () => {
  const digest = formatDecisionDigest([{ id: "AD-001", title: "AD-001 — Quiet" }]);
  assert.doesNotMatch(digest, /NEEDS YOUR ACTION/);
  assert.match(digest, /Decisions that landed \(1\)/);
});

// why: the title already carries its own id, and printing both read as a stutter in the first draft.
test("the digest does not repeat the decision id", () => {
  const digest = formatDecisionDigest([{ id: "AD-025", title: "AD-025 — Something" }]);
  assert.equal(digest.split("AD-025").length - 1, 1);
});

test("the seen revision round-trips, and an absent marker is null rather than a default", async () => {
  const root = tempRoot();
  try {
    assert.equal(readReleaseSeen(root), null);
    await writeReleaseSeen(root, "abc1234");
    assert.equal(readReleaseSeen(root)?.revision, "abc1234");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a corrupt seen marker reads as absent rather than throwing on the update path", async () => {
  const root = tempRoot();
  try {
    await writeReleaseSeen(root, "abc1234");
    const path = join(root, ".tlc", "harness", "state", "release-seen.json");
    writeFileSync(path, "{ not json");
    assert.equal(readReleaseSeen(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// invariant: the three decisions that broke something this week each say what to do about it. Shipping the mechanism
// with none of the content would be the announcement rail all over again.
test("the decisions that broke something carry a migration note", () => {
  const repoRoot = join(import.meta.dirname, "..", "..", "..", "..");
  for (const file of ["ad-025.md", "ad-027.md", "ad-029.md"]) {
    const decision = readDecision(repoRoot, file);
    assert.ok(decision, file);
    assert.ok((decision?.migration ?? "").length > 40, `${file} has no usable migration note`);
  }
});
