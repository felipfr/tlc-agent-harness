import assert from "node:assert/strict";
import { test } from "node:test";
import { isCommandResolutionFailure, isRecipeRunner, shouldAppendFiles } from "../gate.command.ts";

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
