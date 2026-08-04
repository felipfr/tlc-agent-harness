import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildTestSteps, TEST_ENV_IMPORT } from "../../bin/tlc-cli.ts";
import { PROJECT_SCOPED_ENV } from "../test-env.names.mjs";

// invariant: the names come from test-env.names.mjs, which has no side effect. Importing test-env.mjs here
// would run its delete loop, so the guard would clean the environment it is asserting about and could never
// fail — verified: it passed with the variable set and the --import absent.
// hazard: this is the guard for a defect that cost four blocked stop loops and 22 failures across five
// unrelated subsystems. The suite read CLAUDE_PROJECT_DIR from whatever launched it, so a fixture in a temp
// directory resolved against the real repository. It passed from a shell and failed from inside a hook.
test("no project-identifying variable reaches a test", () => {
  for (const name of PROJECT_SCOPED_ENV) {
    assert.equal(
      process.env[name],
      undefined,
      `${name} leaked into the suite. The runner must be launched with ${TEST_ENV_IMPORT.join(" ")} — see tools/test-env.mjs.`,
    );
  }
});

// why: asserting the effect alone would pass if someone dropped the --import while running from a clean shell,
// and the 22 failures would come back the next time a hook ran the gate. The wiring is the thing that decays.
test("both suites are launched through the setup module", () => {
  const suites = buildTestSteps().filter((step) => step.label.endsWith("suite"));

  assert.equal(suites.length, 2, "expected a src suite and a tools suite");
  for (const suite of suites) {
    assert.ok(
      suite.args.join(" ").includes(TEST_ENV_IMPORT.join(" ")),
      `${suite.label} does not load the hermetic setup module`,
    );
  }
});

/**
 * invariant: `TLC_HOME` is redirected, not deleted. Deleting it would send every test at the developer's real
 * `~/.tlc/harness`, which is the opposite of hermetic; an empty temp directory is a runtime home that exists and
 * contains nothing.
 *
 * hazard: this variable was deliberately left alone, on the reasoning that it names which runtime and that CI sets
 * it on purpose. That held only while nothing machine-wide lived under it. The global lesson tier does, so a test
 * calling `allLessons` without pinning the home read whichever lessons the developer had promoted — green on a
 * fresh machine, green in CI, red on mine the moment I promoted five ([/decisions/ad-042.md](/decisions/ad-042.md)).
 */
test("TLC_HOME is redirected to an empty directory rather than deleted", () => {
  assert.ok(
    !PROJECT_SCOPED_ENV.includes("TLC_HOME"),
    "it is redirected, so it must not be in the delete list",
  );
  const home = process.env.TLC_HOME;
  assert.ok(home, "the suite must run with a runtime home");
  assert.notEqual(home, join(homedir(), ".tlc", "harness"), "the suite must not read the real runtime home");
  assert.equal(existsSync(join(home, "state", "lessons.json")), false, "the runtime home must start empty");
});

// hazard: the assertion above reads ambient state, so it would pass even if the module were inert while running
// from a shell that happened to have no TLC_HOME. This spawns a child that *does* have one and asks whether the
// module moved it — the same discipline the delete-loop probe below follows.
test("the setup module redirects a TLC_HOME that is already set", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "./tools/test-env.mjs",
      "--input-type=module",
      "--eval",
      'if (process.env.TLC_HOME === "/leaked-runtime") { process.exit(9); }',
    ],
    {
      cwd: join(dirname(fileURLToPath(import.meta.url)), "..", ".."),
      env: { ...process.env, TLC_HOME: "/leaked-runtime" } as NodeJS.ProcessEnv,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, `TLC_HOME survived the setup module: ${result.stderr}`);
});

// hazard: the assertion above only fires when the variable is actually set, so from a clean shell it passes
// even if the module were inert — the discrimination sensor proved exactly that by emptying the delete loop
// with no test failing. This spawns a child with the variable set and asks whether the module removes it, which
// tests the mechanism instead of the ambient state.
test("the setup module removes each variable in a process that has them", () => {
  const probe = PROJECT_SCOPED_ENV.map(
    (name) => `if (process.env[${JSON.stringify(name)}] !== undefined) { process.exit(9); }`,
  ).join("\n");

  const result = spawnSync(
    process.execPath,
    ["--import", "./tools/test-env.mjs", "--input-type=module", "--eval", probe],
    {
      cwd: join(dirname(fileURLToPath(import.meta.url)), "..", ".."),
      env: Object.fromEntries([
        ...Object.entries(process.env),
        ...PROJECT_SCOPED_ENV.map((name) => [name, "/leaked"]),
      ]) as NodeJS.ProcessEnv,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, `a variable survived the setup module: ${result.stderr}`);
});
