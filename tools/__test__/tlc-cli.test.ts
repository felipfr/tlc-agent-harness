import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, test } from "node:test";
import {
  buildTestSteps,
  ensureFlagsDir,
  gatesPaused,
  grindFlagPath,
  grindOn,
  headsDownFlagPath,
  helpText,
  modeFilePath,
  pairedFlagPath,
  pricesHelpText,
  readMode,
  resolveExecutable,
  resolveProjectRoot,
  route,
  runTestSteps,
  setGateCommand,
  setGrind,
  setMode,
  setPaused,
  skipFlagPath,
  statusJson,
  statusText,
  UsageError,
} from "../../bin/tlc-cli.ts";
import { coreFacade } from "../../src/core/index.ts";
import { flagsDir, projectConfigPath, projectStateDir } from "../../src/platform/paths.ts";

function fixtureRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-cli-"));
}

const cleanupRoots: string[] = [];

function newRoot(): string {
  const root = fixtureRoot();
  cleanupRoots.push(root);
  return root;
}

afterEach(() => {
  while (cleanupRoots.length > 0) {
    const root = cleanupRoots.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe("resolveProjectRoot", () => {
  const original = process.env.TLC_PROJECT_DIR;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.TLC_PROJECT_DIR;
    } else {
      process.env.TLC_PROJECT_DIR = original;
    }
  });

  test("honors TLC_PROJECT_DIR when set", () => {
    process.env.TLC_PROJECT_DIR = "/some/project";
    assert.equal(resolveProjectRoot(), "/some/project");
  });

  test("falls back to process.cwd() when unset", () => {
    delete process.env.TLC_PROJECT_DIR;
    assert.equal(resolveProjectRoot(), process.cwd());
  });
});

describe("flag file paths", () => {
  test("grindFlagPath lands under state/flags/grind-on", () => {
    const root = newRoot();
    assert.equal(grindFlagPath(root), join(flagsDir(root), "grind-on"));
    assert.ok(grindFlagPath(root).includes(join("state", "flags", "grind-on")));
  });

  test("skipFlagPath lands under state/flags/skip-verify", () => {
    const root = newRoot();
    assert.equal(skipFlagPath(root), join(flagsDir(root), "skip-verify"));
  });

  test("headsDownFlagPath and pairedFlagPath land under state/flags", () => {
    const root = newRoot();
    assert.equal(headsDownFlagPath(root), join(flagsDir(root), "heads-down"));
    assert.equal(pairedFlagPath(root), join(flagsDir(root), "paired"));
  });

  test("modeFilePath lands under state/ but not state/flags/", () => {
    const root = newRoot();
    assert.equal(modeFilePath(root), join(projectStateDir(root), "harness-mode"));
    assert.equal(modeFilePath(root).includes(join("state", "flags")), false);
  });
});

describe("setGrind", () => {
  test("on writes grind-on flag file under state/flags/", () => {
    const root = newRoot();
    setGrind(root, true);
    assert.ok(existsSync(grindFlagPath(root)));
  });

  test("off removes an existing grind-on flag file", () => {
    const root = newRoot();
    setGrind(root, true);
    setGrind(root, false);
    assert.equal(existsSync(grindFlagPath(root)), false);
  });

  test("off is a no-op when no flag file exists", () => {
    const root = newRoot();
    assert.doesNotThrow(() => setGrind(root, false));
    assert.equal(existsSync(grindFlagPath(root)), false);
  });
});

describe("setPaused", () => {
  test("on writes the skip-verify flag file", () => {
    const root = newRoot();
    setPaused(root, true);
    assert.ok(existsSync(skipFlagPath(root)));
  });

  test("off removes the skip-verify flag file", () => {
    const root = newRoot();
    setPaused(root, true);
    setPaused(root, false);
    assert.equal(existsSync(skipFlagPath(root)), false);
  });
});

describe("setMode", () => {
  test("solo writes 'solo' to the mode file", () => {
    const root = newRoot();
    setMode(root, "solo");
    assert.equal(readFileSync(modeFilePath(root), "utf8").trim(), "solo");
  });

  test("paired writes 'paired' to the mode file", () => {
    const root = newRoot();
    setMode(root, "paired");
    assert.equal(readFileSync(modeFilePath(root), "utf8").trim(), "paired");
  });

  test("focus alias maps to 'heads-down' in the mode file", () => {
    const root = newRoot();
    setMode(root, "focus");
    assert.equal(readFileSync(modeFilePath(root), "utf8").trim(), "heads-down");
  });

  test("heads alias maps to 'heads-down' in the mode file", () => {
    const root = newRoot();
    setMode(root, "heads");
    assert.equal(readFileSync(modeFilePath(root), "utf8").trim(), "heads-down");
  });

  test("an invalid mode throws UsageError and writes nothing", () => {
    const root = newRoot();
    assert.throws(() => setMode(root, "bogus"), UsageError);
    assert.equal(existsSync(modeFilePath(root)), false);
  });
});

describe("readMode", () => {
  test("defaults to 'solo' with no mode file or flags", () => {
    const root = newRoot();
    assert.equal(readMode(root), "solo");
  });

  test("reads 'paired' from the mode file", () => {
    const root = newRoot();
    setMode(root, "paired");
    assert.equal(readMode(root), "paired");
  });

  test("maps a 'heads-down' mode file to 'focus'", () => {
    const root = newRoot();
    setMode(root, "focus");
    assert.equal(readMode(root), "focus");
  });

  test("falls back to the heads-down flag file when no mode file exists", () => {
    const root = newRoot();
    setGrind(root, false);
    mkdirSync(flagsDir(root), { recursive: true });
    writeFileSync(headsDownFlagPath(root), "");
    assert.equal(readMode(root), "focus");
  });

  test("falls back to the paired flag file when no mode file exists", () => {
    const root = newRoot();
    mkdirSync(flagsDir(root), { recursive: true });
    writeFileSync(pairedFlagPath(root), "");
    assert.equal(readMode(root), "paired");
  });
});

describe("grindOn / gatesPaused", () => {
  test("grindOn is true once the grind-on flag is set", () => {
    const root = newRoot();
    assert.equal(grindOn(root), false);
    setGrind(root, true);
    assert.equal(grindOn(root), true);
  });

  test("grindOn is true when mode is focus even without the grind flag", () => {
    const root = newRoot();
    setMode(root, "focus");
    assert.equal(grindOn(root), true);
  });

  test("gatesPaused reflects the skip-verify flag", () => {
    const root = newRoot();
    assert.equal(gatesPaused(root), false);
    setPaused(root, true);
    assert.equal(gatesPaused(root), true);
  });
});

describe("statusText / help text", () => {
  test("statusText names the project root and current mode", () => {
    const root = newRoot();
    const text = statusText(root);
    assert.ok(text.includes(root));
    assert.ok(text.includes("mode:   solo"));
  });

  test("statusJson carries the same three facts as data, with no prose", () => {
    const root = newRoot();
    assert.deepEqual(statusJson(root), {
      root,
      mode: "solo",
      modeOrigin: "config",
      grind: false,
      gatesPaused: false,
    });
  });

  test("statusJson tracks grind and pause state", () => {
    const root = newRoot();
    setGrind(root, true);
    setPaused(root, true);
    assert.deepEqual(statusJson(root), {
      root,
      mode: "solo",
      modeOrigin: "config",
      grind: true,
      gatesPaused: true,
    });
  });

  test("statusJson reports focus mode, which forces grind on without a flag file", () => {
    const root = newRoot();
    setMode(root, "focus");
    const report = statusJson(root);
    assert.equal(report.mode, "focus");
    assert.equal(report.grind, true);
  });

  test("helpText names 'tlc harness', never bare 'harness'", () => {
    const text = helpText();
    assert.ok(text.includes("tlc harness"));
    const bareHarness = text.match(/(?<!tlc )\bharness\b/);
    assert.equal(bareHarness, null);
  });

  test("pricesHelpText names 'tlc harness', never bare 'harness'", () => {
    const text = pricesHelpText();
    assert.ok(text.includes("tlc harness"));
    const bareHarness = text.match(/(?<!tlc )\bharness\b/);
    assert.equal(bareHarness, null);
  });
});

describe("route — dispatch table", () => {
  test("defaults to status when no subcommand is given", () => {
    assert.deepEqual(route([]), { kind: "status" });
  });

  test("doctor forwards its own arguments to the entry", () => {
    assert.deepEqual(route(["doctor", "--json"]), {
      kind: "entry",
      entry: "doctor",
      args: ["--json"],
    });
  });

  test("routes doctor, build, update, and test", () => {
    assert.deepEqual(route(["doctor"]), { kind: "entry", entry: "doctor", args: [] });
    assert.deepEqual(route(["build"]), { kind: "build" });
    assert.deepEqual(route(["update"]), { kind: "update" });
    assert.deepEqual(route(["test"]), { kind: "test" });
  });

  test("routes grind on/off and rejects a bad argument", () => {
    assert.deepEqual(route(["grind", "on"]), { kind: "grind", on: true });
    assert.deepEqual(route(["grind", "off"]), { kind: "grind", on: false });
    assert.throws(() => route(["grind", "sideways"]), UsageError);
  });

  test("routes pause and resume", () => {
    assert.deepEqual(route(["pause"]), { kind: "pause" });
    assert.deepEqual(route(["resume"]), { kind: "resume" });
  });

  test("mode requires an argument", () => {
    assert.throws(() => route(["mode"]), UsageError);
    assert.deepEqual(route(["mode", "paired"]), { kind: "mode", value: "paired" });
  });

  test("routes prices help/refresh/lookup and rejects a missing model id", () => {
    assert.deepEqual(route(["prices"]), { kind: "prices-help" });
    assert.deepEqual(route(["prices", "refresh"]), { kind: "prices-refresh", scope: "all" });
    assert.deepEqual(route(["prices", "refresh", "cursor"]), {
      kind: "prices-refresh",
      scope: "cursor",
    });
    assert.deepEqual(route(["prices", "lookup", "gpt-5"]), {
      kind: "prices-lookup",
      modelId: "gpt-5",
    });
    assert.throws(() => route(["prices", "lookup"]), UsageError);
  });

  test("routes obs, lessons, and init to their tool entries with remaining args forwarded", () => {
    assert.deepEqual(route(["obs", "live"]), { kind: "entry", entry: "obs-cli", args: ["live"] });
    assert.deepEqual(route(["lessons", "list"]), {
      kind: "entry",
      entry: "lessons-cli",
      args: ["list"],
    });
    assert.deepEqual(route(["init", "--minimal"]), {
      kind: "entry",
      entry: "init-project",
      args: ["--minimal"],
    });
  });

  test("help with no topic returns the built-in help; with a topic routes to help-topic", () => {
    assert.deepEqual(route(["help"]), { kind: "help" });
    assert.deepEqual(route(["help", "prices"]), {
      kind: "entry",
      entry: "help-topic",
      args: ["prices"],
    });
  });

  test("an unrecognized subcommand routes to 'unknown'", () => {
    assert.deepEqual(route(["nonsense"]), { kind: "unknown", cmd: "nonsense" });
  });
});

describe("harness test — step plan and runner", () => {
  test("buildTestSteps runs build check, boundaries, docs-bundle, and every __test__ suite in order", () => {
    const steps = buildTestSteps();
    assert.deepEqual(
      steps.map((s) => s.label),
      [
        "biome check",
        "tsc --noEmit",
        "src suite",
        "tools suite",
        "check-boundaries",
        "check-docs-bundle",
        "capabilities in sync",
      ],
    );
    // why: both suites carry the hermetic setup module. Without it the runner reads CLAUDE_PROJECT_DIR from
    // whatever launched it and 22 tests resolve against the real repository instead of their own fixtures.
    assert.deepEqual(steps[2]?.args, [
      "--import",
      "./tools/test-env.mjs",
      "--test",
      "src/**/__test__/*.test.ts",
    ]);
    assert.deepEqual(steps[3]?.args, [
      "--import",
      "./tools/test-env.mjs",
      "--test",
      "tools/__test__/*.test.ts",
    ]);
    assert.deepEqual(steps[4]?.args, ["tools/check-boundaries.ts"]);
    assert.deepEqual(steps[5]?.args, ["tools/check-docs-bundle.ts"]);
    assert.deepEqual(steps[6]?.args, ["tools/render-capabilities.ts", "--check"]);
  });

  test("stops at the first failing step and does not run the rest", () => {
    const calls: string[] = [];
    const status = runTestSteps(buildTestSteps(), "/repo", (bin, args, cwd) => {
      calls.push(`${bin} ${args.join(" ")}`);
      assert.equal(cwd, "/repo");
      return { status: calls.length === 2 ? 1 : 0 };
    });
    assert.equal(status, 1);
    assert.deepEqual(calls, ["npx biome check", "npx tsc --noEmit"]);
  });

  test("runs every step and returns 0 when all pass", () => {
    const calls: string[] = [];
    const status = runTestSteps(buildTestSteps(), "/repo", (bin) => {
      calls.push(bin);
      return { status: 0 };
    });
    assert.equal(status, 0);
    assert.equal(calls.length, buildTestSteps().length);
  });
});

describe("status agrees with the policy the hooks resolve", () => {
  function writePolicy(root: string, patch: Record<string, unknown>): void {
    const path = projectConfigPath(root);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(patch), "utf8");
  }

  // hazard: status used to read flag files only and default to "solo", so a project whose policy set
  // heads-down reported solo with grind off while every hook resolved the opposite.
  test("policy mode heads-down reports focus, with config as the origin", () => {
    const root = newRoot();
    writePolicy(root, { version: 1, mode: "heads-down" });
    const report = statusJson(root);
    assert.equal(report.mode, "focus");
    assert.equal(report.modeOrigin, "config");
    assert.equal(report.grind, true, "heads-down forces grind on, exactly as the loader does");
  });

  test("policy grind.enabled is reported without any flag file", () => {
    const root = newRoot();
    writePolicy(root, { version: 1, grind: { enabled: true } });
    const report = statusJson(root);
    assert.equal(report.grind, true);
    assert.equal(report.mode, "solo");
  });

  test("a mode file keeps precedence over the policy, and says so", () => {
    const root = newRoot();
    writePolicy(root, { version: 1, mode: "heads-down" });
    setMode(root, "paired");
    const report = statusJson(root);
    assert.equal(report.mode, "paired");
    assert.equal(report.modeOrigin, "file");
  });

  test("a flag keeps precedence over the policy, and says so", () => {
    const root = newRoot();
    writePolicy(root, { version: 1, mode: "solo" });
    ensureFlagsDir(root);
    writeFileSync(headsDownFlagPath(root), "");
    const report = statusJson(root);
    assert.equal(report.mode, "focus");
    assert.equal(report.modeOrigin, "flag");
  });

  test("an unrecognised mode file is ignored, matching the loader", () => {
    const root = newRoot();
    writePolicy(root, { version: 1, mode: "paired" });
    ensureFlagsDir(root);
    writeFileSync(modeFilePath(root), "sideways\n");
    const report = statusJson(root);
    assert.equal(report.mode, "paired");
    assert.equal(report.modeOrigin, "config");
  });

  test("the text form renders the same three values as the json form", () => {
    const root = newRoot();
    writePolicy(root, { version: 1, mode: "heads-down" });
    const report = statusJson(root);
    const text = statusText(root);
    assert.ok(text.includes(report.mode));
    assert.ok(text.includes(`from ${report.modeOrigin}`));
    assert.match(text, /grind: {2}ON/);
  });

  test("pause still comes from the flag the stop reads", () => {
    const root = newRoot();
    writePolicy(root, { version: 1 });
    assert.equal(statusJson(root).gatesPaused, false);
    setPaused(root, true);
    assert.equal(statusJson(root).gatesPaused, true);
  });
});

describe("gate command", () => {
  function writeConfig(root: string, content: string): void {
    const path = projectConfigPath(root);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  }

  function readConfig(root: string): Record<string, never> {
    return JSON.parse(readFileSync(projectConfigPath(root), "utf8"));
  }

  test("route accepts both fields and rejects anything else", () => {
    assert.deepEqual(route(["gate", "test-command", "node", "--test"]), {
      kind: "gate",
      field: "test",
      argv: ["node", "--test"],
    });
    assert.deepEqual(route(["gate", "lint-command", "npx", "biome"]), {
      kind: "gate",
      field: "lint",
      argv: ["npx", "biome"],
    });
    assert.throws(() => route(["gate"]), UsageError);
    assert.throws(() => route(["gate", "whatever"]), UsageError);
  });

  test("the argv is written as an array and reported back", () => {
    const root = newRoot();
    writeConfig(root, JSON.stringify({ version: 1 }, null, 2));
    const message = setGateCommand(root, "test", ["node", "--test", "src/**/*.test.ts"], true);

    assert.deepEqual(readConfig(root).grind, { testCommand: ["node", "--test", "src/**/*.test.ts"] });
    assert.match(message, /grind\.testCommand/);
    assert.match(message, /--test/);
  });

  test("lint-command writes the sibling field without disturbing the other", () => {
    const root = newRoot();
    writeConfig(root, JSON.stringify({ grind: { testCommand: ["node"], maxLoops: 3 } }, null, 2));
    setGateCommand(root, "lint", ["npx", "biome", "check", "."], true);

    assert.deepEqual(readConfig(root).grind, {
      testCommand: ["node"],
      maxLoops: 3,
      lintCommand: ["npx", "biome", "check", "."],
    });
  });

  // why: the write has to be reviewable as one changed field. Canonical two-space JSON is byte-for-byte what
  // these configs already are, so every untouched line stays put.
  test("every untouched field survives byte-for-byte", () => {
    const root = newRoot();
    const original = { version: 1, codePaths: ["src"], grind: { enabled: true, maxLoops: 3 } };
    writeConfig(root, `${JSON.stringify(original, null, 2)}\n`);
    setGateCommand(root, "test", ["node", "--test"], true);

    const after = readFileSync(projectConfigPath(root), "utf8");
    const expected = `${JSON.stringify(
      {
        version: 1,
        codePaths: ["src"],
        grind: { enabled: true, maxLoops: 3, testCommand: ["node", "--test"] },
      },
      null,
      2,
    )}\n`;
    assert.equal(after, expected);
  });

  test("an empty argv is a usage error and writes nothing", () => {
    const root = newRoot();
    writeConfig(root, JSON.stringify({ version: 1 }));
    assert.throws(() => setGateCommand(root, "test", [], true), UsageError);
    assert.equal(readConfig(root).grind, undefined);
  });

  // invariant: a second layer behind the floor. The floor refuses this command from inside an agent session;
  // this refuses it from anything that is not a person at a terminal.
  test("a non-interactive invocation is refused and writes nothing", () => {
    const root = newRoot();
    writeConfig(root, JSON.stringify({ version: 1 }));
    assert.throws(() => setGateCommand(root, "test", ["node", "--test"], false), UsageError);
    assert.equal(readConfig(root).grind, undefined);
  });

  test("a binary that is not on PATH is refused and writes nothing", () => {
    const root = newRoot();
    writeConfig(root, JSON.stringify({ version: 1 }));
    assert.throws(
      () => setGateCommand(root, "test", ["definitely-not-a-real-binary-xyz", "--test"], true),
      UsageError,
    );
    assert.equal(readConfig(root).grind, undefined);
  });

  test("resolveExecutable finds a name on PATH and rejects one that is absent", () => {
    assert.ok(resolveExecutable("node") !== null);
    assert.equal(resolveExecutable("definitely-not-a-real-binary-xyz"), null);
    assert.equal(resolveExecutable("also-not-real", { PATH: "" }, "linux"), null);
  });

  test("writing a gate command refreshes the baseline, so the session is not blocked", () => {
    const root = newRoot();
    writeConfig(root, JSON.stringify({ version: 1 }, null, 2));
    coreFacade.policy.recordPolicyBaseline(root, "s1");
    setGateCommand(root, "test", ["node", "--test"], true);

    assert.equal(coreFacade.policy.checkPolicyBaseline(root, "s1").kind, "allow");
  });

  test("the flag mutators refresh the baseline too, and an out-of-band write does not", () => {
    const root = newRoot();
    writeConfig(root, JSON.stringify({ version: 1 }, null, 2));
    coreFacade.policy.recordPolicyBaseline(root, "s1");

    setPaused(root, true);
    assert.equal(coreFacade.policy.checkPolicyBaseline(root, "s1").kind, "allow");
    setGrind(root, true);
    assert.equal(coreFacade.policy.checkPolicyBaseline(root, "s1").kind, "allow");
    setMode(root, "solo");
    assert.equal(coreFacade.policy.checkPolicyBaseline(root, "s1").kind, "allow");

    // why: the same effect reached without a harness command stays visible, which is the whole point.
    writeFileSync(join(flagsDir(root), "skip-verify"), "", "utf8");
    rmSync(join(flagsDir(root), "skip-verify"));
    writeConfig(root, JSON.stringify({ version: 1, mode: "paired" }, null, 2));
    assert.equal(coreFacade.policy.checkPolicyBaseline(root, "s1").kind, "deny");
  });

  test("help names the new subcommand", () => {
    assert.match(helpText(), /gate test-command/);
    assert.match(helpText(), /gate lint-command/);
  });
});
