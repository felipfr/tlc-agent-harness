import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  checkLessonLink,
  formatLessonLink,
  lessonLinkVerdict,
  parseLessonLink,
  worstLinkStatus,
} from "../lesson.link.ts";

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "tlc-lesson-link-"));
  mkdirSync(join(root, "tools"), { recursive: true });
  writeFileSync(join(root, "tools", "gate.ts"), "export function runGate(): void {}\n", "utf8");
  return root;
}

test("a path with a symbol parses into both halves", () => {
  assert.deepEqual(parseLessonLink("tools/gate.ts:runGate"), { path: "tools/gate.ts", symbol: "runGate" });
});

test("a bare path parses without a symbol", () => {
  assert.deepEqual(parseLessonLink("tools/gate.ts"), { path: "tools/gate.ts" });
});

test("a trailing separator is a path, not an empty symbol", () => {
  assert.deepEqual(parseLessonLink("tools/gate.ts:"), { path: "tools/gate.ts:" });
});

test("blank input parses to nothing rather than to an unresolvable link", () => {
  assert.equal(parseLessonLink("   "), null);
});

test("formatting round-trips a parsed link", () => {
  const raw = "tools/gate.ts:runGate";
  const link = parseLessonLink(raw);
  assert.ok(link);
  assert.equal(formatLessonLink(link), raw);
});

test("a present path with a present symbol reads present", () => {
  const root = tempRoot();
  try {
    assert.equal(checkLessonLink(root, { path: "tools/gate.ts", symbol: "runGate" }), "present");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a renamed path reads path-missing", () => {
  const root = tempRoot();
  try {
    assert.equal(checkLessonLink(root, { path: "tools/renamed.ts" }), "path-missing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a deleted symbol in a surviving file reads symbol-missing", () => {
  const root = tempRoot();
  try {
    assert.equal(checkLessonLink(root, { path: "tools/gate.ts", symbol: "deletedName" }), "symbol-missing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// hazard: an absolute path resolves against a machine, so a global lesson would report `present` in every
// product on that machine that happens to contain the file.
test("an absolute path never resolves", () => {
  const root = tempRoot();
  try {
    assert.equal(checkLessonLink(root, { path: join(root, "tools", "gate.ts") }), "path-missing");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unreadable file reads unreadable, which is not a stale verdict", (t) => {
  const root = tempRoot();
  try {
    const path = join(root, "tools", "locked.ts");
    writeFileSync(path, "export const locked = 1;\n", "utf8");
    chmodSync(path, 0o000);
    const status = checkLessonLink(root, { path: "tools/locked.ts", symbol: "locked" });
    if (status === "present") {
      // why: a privileged process can read a 000 file, so the platform decides whether this case is reachable.
      t.skip("this process can read a mode-000 file");
      return;
    }
    assert.equal(status, "unreadable");
    assert.equal(lessonLinkVerdict(root, [{ path: "tools/locked.ts", symbol: "locked" }]).stale, false);
  } finally {
    chmodSync(join(root, "tools", "locked.ts"), 0o600);
    rmSync(root, { recursive: true, force: true });
  }
});

test("a lesson with no refs is never stale", () => {
  const root = tempRoot();
  try {
    assert.deepEqual(lessonLinkVerdict(root, []), { status: "present", stale: false, brokenRefs: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("one broken ref among several makes the verdict stale and names only the broken one", () => {
  const root = tempRoot();
  try {
    const verdict = lessonLinkVerdict(root, [
      { path: "tools/gate.ts", symbol: "runGate" },
      { path: "tools/gone.ts" },
    ]);
    assert.equal(verdict.stale, true);
    assert.equal(verdict.status, "path-missing");
    assert.deepEqual(verdict.brokenRefs, ["tools/gone.ts"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the worst status wins so a missing path outranks a missing symbol", () => {
  assert.equal(worstLinkStatus(["present", "symbol-missing", "path-missing"]), "path-missing");
  assert.equal(worstLinkStatus(["present", "unreadable"]), "unreadable");
  assert.equal(worstLinkStatus([]), "present");
});
