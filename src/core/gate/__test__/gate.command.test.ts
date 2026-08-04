import assert from "node:assert/strict";
import { test } from "node:test";
import {
  appendFilesVerdict,
  isCommandResolutionFailure,
  isRecipeRunner,
  shouldAppendFiles,
} from "../gate.command.ts";

test("recipe runners are recognised by executable name, path and windows extension", () => {
  assert.equal(isRecipeRunner(["just", "check"]), true);
  assert.equal(isRecipeRunner(["/usr/local/bin/just", "test"]), true);
  assert.equal(isRecipeRunner(["Just.exe", "test"]), true);
  assert.equal(isRecipeRunner(["make", "test"]), true);
  assert.equal(isRecipeRunner(["task", "test"]), true);
  assert.equal(isRecipeRunner(["mise", "run", "test"]), true);
  assert.equal(isRecipeRunner(["rake", "test"]), true);
});

test("file-accepting runners are not recipe runners", () => {
  assert.equal(isRecipeRunner(["bun", "test"]), false);
  assert.equal(isRecipeRunner(["npx", "vitest", "run"]), false);
  assert.equal(isRecipeRunner(["pytest"]), false);
  assert.equal(isRecipeRunner(["go", "test", "./..."]), false);
});

test("auto mode withholds files from a recipe runner and passes them to everything else", () => {
  assert.equal(shouldAppendFiles(["just", "check"], "auto"), false);
  assert.equal(shouldAppendFiles(["make", "test"], "auto"), false);
  assert.equal(shouldAppendFiles(["bun", "test"], "auto"), true);
  assert.equal(shouldAppendFiles(["npx", "vitest", "run"], "auto"), true);
});

test("explicit modes override detection", () => {
  assert.equal(shouldAppendFiles(["just", "check"], "always"), true);
  assert.equal(shouldAppendFiles(["bun", "test"], "never"), false);
});

test("an empty command never receives files", () => {
  assert.equal(shouldAppendFiles([], "auto"), false);
  assert.equal(shouldAppendFiles([], "always"), false);
});

test("exit 127 is a resolution failure whatever the output says", () => {
  assert.equal(isCommandResolutionFailure({ exitCode: 127, output: "" }), true);
  assert.equal(isCommandResolutionFailure({ exitCode: 127, output: "vitest: not found" }), true);
});

test("runner messages that mean the target was never resolved are resolution failures", () => {
  assert.equal(
    isCommandResolutionFailure({
      exitCode: 1,
      output: "error: justfile does not contain recipe `packages/api/src/user.test.ts`",
    }),
    true,
  );
  assert.equal(
    isCommandResolutionFailure({ exitCode: 2, output: "make: *** No rule to make target 'src/a.test.ts'." }),
    true,
  );
  assert.equal(isCommandResolutionFailure({ exitCode: 1, output: 'npm error Missing script: "test"' }), true);
  assert.equal(isCommandResolutionFailure({ exitCode: 1, output: 'task "verify" does not exist' }), true);
  assert.equal(
    isCommandResolutionFailure({ exitCode: 1, output: "rake aborted! Don't know how to build task 'test'" }),
    true,
  );
});

test("a failing assertion is not a resolution failure", () => {
  assert.equal(isCommandResolutionFailure({ exitCode: 1, output: "1 fail\nexpected 200, got 401" }), false);
  assert.equal(isCommandResolutionFailure({ exitCode: 1, output: "AssertionError: values differ" }), false);
});

// hazard: `npm` was absent from the no-append set while `missing script:` sat in the resolution-failure patterns —
// the codebase already knew npm invokes a script and still appended file paths to it. Measured on a real install
// ([/decisions/ad-033.md](/decisions/ad-033.md)).
test("a package-manager script does not receive appended files", () => {
  for (const command of [
    ["npm", "test"],
    ["yarn", "test"],
    ["pnpm", "test"],
    ["bun", "run", "test"],
  ]) {
    const verdict = appendFilesVerdict(command, "auto");
    assert.equal(verdict.appends, false, command.join(" "));
    assert.match(verdict.reason ?? "", /invokes a script/, command.join(" "));
  }
});

// why: the same reason as a recipe runner — the argument goes to somebody else's script, and what that script does
// with a path is not something this process can reason about.
test("the reason given is that the harness cannot know, not that it refuses", () => {
  assert.match(
    appendFilesVerdict(["npm", "test"], "auto").reason ?? "",
    /cannot know|not something the harness can know/,
  );
});

// hazard: a command carrying its own glob walks the glob regardless, so appending narrows nothing. Measured: an
// eslint command globbing src and test linted the whole tree on every stop.
test("a command that already globs does not receive appended files", () => {
  const verdict = appendFilesVerdict(["npx", "eslint", "src/**/*.ts", "test/**/*.ts", "--no-fix"], "auto");
  assert.equal(verdict.appends, false);
  assert.match(verdict.reason ?? "", /already scopes itself/);
});

// why: `npx` runs the tool named next, and that tool decides whether a path narrows. Treating npx as a script runner
// would refuse to narrow `npx jest <file>`, which is the shape narrowing exists for.
test("a transparent prefix leaves a real tool narrowing", () => {
  assert.equal(appendFilesVerdict(["npx", "jest"], "auto").appends, true);
  assert.equal(appendFilesVerdict(["npx", "vitest", "run"], "auto").appends, true);
  assert.equal(appendFilesVerdict(["bunx", "jest"], "auto").appends, true);
});

// hazard: the assertion above passes whether or not the prefix is resolved, because `npx` is in no deny set — a
// sensor caught it surviving the removal of the resolution entirely. The nested case is where resolving is
// load-bearing: without it, a script runner behind a prefix would receive appended files
// ([/decisions/ad-033.md](/decisions/ad-033.md)).
test("a script runner behind a transparent prefix is still recognised", () => {
  for (const command of [
    ["npx", "pnpm", "test"],
    ["bunx", "npm", "test"],
  ]) {
    const verdict = appendFilesVerdict(command, "auto");
    assert.equal(verdict.appends, false, command.join(" "));
    assert.match(verdict.reason ?? "", /invokes a script/, command.join(" "));
  }
});

test("bun's own test runner still narrows, while bun run does not", () => {
  assert.equal(appendFilesVerdict(["bun", "test"], "auto").appends, true);
  assert.equal(appendFilesVerdict(["bun", "run", "test"], "auto").appends, false);
});

test("a plain tool still receives the files, which is what narrowing is for", () => {
  assert.equal(appendFilesVerdict(["node", "--test"], "auto").appends, true);
  assert.equal(appendFilesVerdict(["./bin/mytest"], "auto").appends, true);
});

test("always and never override every heuristic, and never says so", () => {
  assert.equal(appendFilesVerdict(["npm", "test"], "always").appends, true);
  assert.equal(appendFilesVerdict(["node", "--test"], "never").appends, false);
  assert.match(appendFilesVerdict(["node", "--test"], "never").reason ?? "", /set to never/);
});

// invariant: the boolean helper stays the same function, so every existing caller keeps its meaning.
test("shouldAppendFiles agrees with the verdict it now delegates to", () => {
  for (const command of [
    ["npm", "test"],
    ["npx", "jest"],
    ["make", "build"],
    ["node", "--test"],
  ]) {
    assert.equal(
      shouldAppendFiles(command, "auto"),
      appendFilesVerdict(command, "auto").appends,
      command.join(" "),
    );
  }
});

test("an empty command appends nothing and says why", () => {
  assert.match(appendFilesVerdict([], "auto").reason ?? "", /empty/);
});
