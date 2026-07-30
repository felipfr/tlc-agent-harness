import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  attachedIdentifier,
  commentViolationMessage,
  findAddedComments,
  isCommentLine,
  type NextCodeLine,
  scanAddedComments,
} from "../comment-policy.service.ts";

test("a line comment is a comment in every language the gate accepts", () => {
  for (const text of ["// x", "  // x", "/* x */", " * continuation", "# x", "  # x"]) {
    assert.equal(isCommentLine(text), true, text);
  }
});

test("code is not a comment", () => {
  for (const text of ["const a = 1;", 'const u = "http://x";', "x = 1  # trailing", "*/"]) {
    assert.equal(isCommentLine(text), false, text);
  }
});

test("tool directives are not counted — they are configuration, not prose", () => {
  for (const text of [
    "// biome-ignore lint/style/noVar: needed",
    "// eslint-disable-next-line",
    "// @ts-expect-error",
    "# noqa: E501",
    "# type: ignore",
    "#!/usr/bin/env node",
  ]) {
    assert.equal(isCommentLine(text), false, text);
  }
});

test("findAddedComments reports file, line and text for each added comment", () => {
  const hits = findAddedComments([
    { file: "a.ts", line: 4, text: "// get the user" },
    { file: "a.ts", line: 5, text: "const u = load();" },
    { file: "b.py", line: 9, text: "# loop through items" },
  ]);
  assert.deepEqual(hits, [
    { file: "a.ts", line: 4, reason: "undeclared comment added this turn", text: "// get the user" },
    { file: "b.py", line: 9, reason: "undeclared comment added this turn", text: "# loop through items" },
  ]);
});

test("a declared reason is allowed; narration with the same shape is not", () => {
  // why: non-adjacent lines, because each of these is an independent comment rather than one
  // comment spanning six lines.
  const hits = findAddedComments([
    { file: "a.ts", line: 1, text: "// why: git rename detection breaks above 50% similarity" },
    { file: "a.ts", line: 3, text: "// hazard: exit 2 becomes an enforcement action" },
    { file: "a.ts", line: 5, text: "// invariant: core never reads raw" },
    { file: "a.ts", line: 7, text: "# why: the runtime has no node_modules" },
    { file: "a.ts", line: 9, text: "// whyever this is not a marker" },
    { file: "a.ts", line: 11, text: "// why:" },
  ]);
  assert.deepEqual(
    hits.map((h) => h.line),
    [9, 11],
  );
});

test("a declared comment longer than the budget is blocked, so one marker cannot cover an essay", () => {
  const essay = Array.from({ length: 6 }, (_, offset) => ({
    file: "a.ts",
    line: 20 + offset,
    text: offset === 0 ? "// why: a real constraint" : `// narration line ${offset}`,
  }));
  const hits = findAddedComments(essay);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.line, 20);
});

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "comment-diff-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
  git("init");
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  return dir;
}

test("a comment already committed is not reported — only what this turn added", async () => {
  const dir = repo();
  try {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/a.ts"), "// pre-existing\nconst a = 1;\n");
    execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore" });
    execFileSync("git", ["-C", dir, "commit", "-m", "base"], { stdio: "ignore" });

    assert.deepEqual(await scanAddedComments(dir, ["src/a.ts"]), []);

    writeFileSync(join(dir, "src/a.ts"), "// pre-existing\nconst a = 1;\n// added now\nconst b = 2;\n");
    const hits = await scanAddedComments(dir, ["src/a.ts"]);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.text, "// added now");
    assert.equal(hits[0]?.line, 3);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every line of an untracked file counts, since all of it is new", async () => {
  const dir = repo();
  try {
    writeFileSync(join(dir, "base.ts"), "const a = 1;\n");
    execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore" });
    execFileSync("git", ["-C", dir, "commit", "-m", "base"], { stdio: "ignore" });

    writeFileSync(join(dir, "new.ts"), "// brand new\nconst b = 2;\n");
    const hits = await scanAddedComments(dir, ["new.ts"]);
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.text, "// brand new");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a removed comment is not reported", async () => {
  const dir = repo();
  try {
    writeFileSync(join(dir, "a.ts"), "// goes away\nconst a = 1;\n");
    execFileSync("git", ["-C", dir, "add", "-A"], { stdio: "ignore" });
    execFileSync("git", ["-C", dir, "commit", "-m", "base"], { stdio: "ignore" });

    writeFileSync(join(dir, "a.ts"), "const a = 1;\n");
    assert.deepEqual(await scanAddedComments(dir, ["a.ts"]), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a repo without git yields nothing rather than throwing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "comment-nogit-"));
  try {
    writeFileSync(join(dir, "a.ts"), "// x\n");
    assert.deepEqual(await scanAddedComments(dir, ["a.ts"]), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("strict mode blocks a declared reason too — no marker escapes it", () => {
  const added = [
    { file: "a.ts", line: 1, text: "// why: upstream returns 0 for a missing key" },
    { file: "a.ts", line: 3, text: "// get the user" },
  ];
  assert.deepEqual(
    findAddedComments(added, "strict").map((h) => h.line),
    [1, 3],
  );
  assert.deepEqual(
    findAddedComments(added, "declared").map((h) => h.line),
    [3],
  );
});

test("tool directives stay exempt in strict mode", () => {
  const added = [
    { file: "a.ts", line: 1, text: "// biome-ignore lint/style/noVar: needed" },
    { file: "a.py", line: 2, text: "# noqa: E501" },
  ];
  assert.deepEqual(findAddedComments(added, "strict"), []);
});

test("the violation message names the mode's own remedy", () => {
  const hits = findAddedComments([{ file: "a.ts", line: 1, text: "// x y z" }], "strict");
  assert.match(commentViolationMessage(hits, "strict"), /does not accept agent-added comments/);
  assert.match(commentViolationMessage(hits, "declared"), /why:/);
});

test("a declared comment spanning several lines counts as one compliant comment", () => {
  const added = [
    { file: "a.ts", line: 10, text: "// hazard: the remote may have moved" },
    { file: "a.ts", line: 11, text: "// since the last fetch, so a plain push would clobber it" },
    { file: "a.ts", line: 12, text: "// and lose commits." },
  ];
  assert.deepEqual(findAddedComments(added), []);
});

test("an undeclared comment spanning several lines is reported once, at its first line", () => {
  const added = [
    { file: "a.ts", line: 4, text: "// increments the counter" },
    { file: "a.ts", line: 5, text: "// and then returns it" },
  ];
  const hits = findAddedComments(added);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.line, 4);
});

test("comments separated by code are separate comments", () => {
  const added = [
    { file: "a.ts", line: 1, text: "// first" },
    { file: "a.ts", line: 2, text: "const x = 1;" },
    { file: "a.ts", line: 3, text: "// second" },
  ];
  assert.equal(findAddedComments(added).length, 2);
});

test("adjacent lines in different files never join into one comment", () => {
  const added = [
    { file: "a.ts", line: 9, text: "// hazard: real reason here" },
    { file: "b.ts", line: 10, text: "// bare narration" },
  ];
  const hits = findAddedComments(added);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.file, "b.ts");
});

test("strict mode reports a declared multi-line comment once, not per line", () => {
  const added = [
    { file: "a.ts", line: 3, text: "// hazard: still a comment" },
    { file: "a.ts", line: 4, text: "// continued" },
  ];
  assert.equal(findAddedComments(added, "strict").length, 1);
});

test("a hash line in TypeScript is not a comment — markdown in a template literal is not narration", () => {
  const added = [
    { file: "report.ts", line: 61, text: "## Activity" },
    { file: "report.ts", line: 66, text: "**Provider:** `x`" },
  ];
  assert.deepEqual(findAddedComments(added), []);
});

test("a hash line in shell and Python is still a comment", () => {
  for (const file of ["deploy.sh", "script.py", "Makefile"]) {
    const hits = findAddedComments([{ file, line: 3, text: "# set the flag" }]);
    assert.equal(hits.length, 1, file);
  }
});

test("slash comments are judged in every language", () => {
  assert.equal(findAddedComments([{ file: "a.ts", line: 1, text: "// narration" }]).length, 1);
  assert.equal(findAddedComments([{ file: "a.py", line: 1, text: "# narration" }]).length, 1);
});

const DECL: Record<number, string> = {
  2: "export function claudeToEvent(raw: Record<string, unknown>): HarnessEvent | null {",
  12: "permissionMode?: string;",
  22: "  return a + b;",
};
const nextLine: NextCodeLine = (_file, line) => DECL[line];

test("a doc comment that tells the caller something the name does not is allowed", () => {
  const added = [
    { file: "a.ts", line: 1, text: "/** Never throws on a malformed payload — returns null instead. */" },
  ];
  assert.deepEqual(findAddedComments(added, "declared", nextLine), []);
});

test("a doc comment that only restates its identifier is blocked", () => {
  const added = [{ file: "a.ts", line: 11, text: "/** The permission mode. */" }];
  const hits = findAddedComments(added, "declared", nextLine);
  assert.equal(hits.length, 1);
  assert.match(hits[0]?.reason ?? "", /only restates permissionMode/);
});

test("a doc comment is not asked for why: — that question is for the modifier, not the caller", () => {
  const added = [{ file: "a.ts", line: 1, text: "/** Adapter-only escape hatch: core must not read it. */" }];
  assert.deepEqual(findAddedComments(added, "declared", nextLine), []);
});

test("wrapping narration in /** */ inside a body does not buy an exemption", () => {
  const added = [{ file: "a.ts", line: 21, text: "/** add the two numbers together */" }];
  const hits = findAddedComments(added, "declared", nextLine);
  assert.equal(hits.length, 1);
  assert.match(hits[0]?.reason ?? "", /undeclared/);
});

test("strict mode blocks doc comments too", () => {
  const added = [{ file: "a.ts", line: 1, text: "/** Never throws on a malformed payload. */" }];
  assert.equal(findAddedComments(added, "strict", nextLine).length, 1);
});

test("attachment is by position: export, member and floating are told apart", () => {
  assert.equal(attachedIdentifier("export function claudeToEvent(raw: unknown) {"), "claudeToEvent");
  assert.equal(attachedIdentifier("export type ProviderPort = {"), "ProviderPort");
  assert.equal(attachedIdentifier("  contextBudgetChars?: number;"), "contextBudgetChars");
  assert.equal(attachedIdentifier("  const total = a + b;"), "total");
  assert.equal(attachedIdentifier("  return total;"), null);
  assert.equal(attachedIdentifier(undefined), null);
});

test("a multi-line doc comment is found by its declaration past the closing */", () => {
  const lines = [
    "export type ShellSegment = {",
    "  /**",
    "   * True when the segment could not be split with confidence, which the caller decides on.",
    "   */",
    "  opaque: boolean;",
    "};",
  ];
  const added = [2, 3].map((line) => ({ file: "a.ts", line, text: lines[line - 1] as string }));
  assert.deepEqual(
    findAddedComments(added, "declared", (_f, line) => lines[line - 1]),
    [],
  );
});
