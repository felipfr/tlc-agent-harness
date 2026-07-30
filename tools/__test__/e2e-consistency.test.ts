import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cleanup: string[] = [];

function newRepo(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(root);
  execFileSync("git", ["init", "-q", "."], { cwd: root });
  execFileSync("git", ["config", "user.email", "e2e@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "E2E"], { cwd: root });
  writeFileSync(join(root, ".gitignore"), ".tlc/\n");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "app.ts"), "export const a = 1;\n");
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "initial"], { cwd: root });
  return root;
}

afterEach(() => {
  while (cleanup.length > 0) {
    const root = cleanup.pop();
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function writePolicy(root: string, policy: Record<string, unknown>): void {
  const path = join(root, ".tlc", "harness", "config.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ version: 1, ...policy }), "utf8");
}

/** Drives a hook exactly as a provider does: JSON on stdin, through the real launcher. */
function hook(handler: string, payload: unknown, root: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [join(repoRoot, "bin", "tlc-exec.mjs"), handler], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, TLC_PROJECT_DIR: root, ...env },
  });
}

function cli(args: string[], root: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [join(repoRoot, "bin", "tlc-cli.ts"), "harness", ...args], {
    encoding: "utf8",
    env: { ...process.env, TLC_PROJECT_DIR: root, ...env },
  });
}

// why: the CLI resolves its own runtime from TLC_HOME, so pointing that at a scratch directory would make it
// look for a launcher that is not there. The entry is the same file the CLI spawns, which is what these cases
// are about — the tool reading policy rather than a module default.
function entry(tool: string, args: string[], root: string, home: string) {
  return spawnSync(process.execPath, [join(repoRoot, "tools", tool), ...args], {
    encoding: "utf8",
    env: { ...process.env, TLC_PROJECT_DIR: root, TLC_HOME: home },
  });
}

function cursorStop(root: string) {
  return {
    hook_event_name: "stop",
    workspace_roots: [root],
    conversation_id: "e2e",
    session_id: "e2e-1",
    status: "completed",
  };
}

// hazard: unit calls cannot catch a defect that lives in how the runtime resolves its own paths or in which
// source a command reads. Every case here goes through bin/tlc-exec.mjs or bin/tlc-cli.ts.
describe("E2E — CG-01: a generated shim names the install path", () => {
  // hazard: init only writes a shim for a provider it detects, and detection reads the provider's own config
  // directory under HOME — not the project. A CI runner has neither, so the case has to build both: a scratch
  // HOME holding ~/.claude, and the conventional install path symlinked at the real runtime.
  test("init writes the conventional install path and never the checkout", () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "tlc-e2e-fakehome-"));
    cleanup.push(fakeHome);
    mkdirSync(join(fakeHome, ".claude"), { recursive: true });
    const conventional = join(fakeHome, ".tlc", "harness");
    mkdirSync(dirname(conventional), { recursive: true });
    try {
      symlinkSync(repoRoot, conventional, "dir");
    } catch {
      return;
    }

    const root = newRepo("tlc-e2e-shim-");
    const result = spawnSync(process.execPath, [join(repoRoot, "tools", "init-project.ts"), "--minimal"], {
      encoding: "utf8",
      env: {
        ...process.env,
        TLC_PROJECT_DIR: root,
        HOME: fakeHome,
        USERPROFILE: fakeHome,
        TLC_HOME: undefined as unknown as string,
        CLAUDE_CONFIG_DIR: undefined as unknown as string,
        CURSOR_CONFIG_DIR: undefined as unknown as string,
      },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const settings = readFileSync(join(root, ".claude", "settings.json"), "utf8");
    assert.ok(
      settings.includes(JSON.stringify(conventional).slice(1, -1)),
      `expected the install path in the shim, got:\n${settings}`,
    );
    assert.equal(
      settings.includes(JSON.stringify(repoRoot).slice(1, -1)),
      false,
      "the shim must not name the checkout the symlink points at",
    );
  });
});

describe("E2E — CG-02: status equals what the stop resolves", () => {
  test("policy heads-down reports focus with grind on, and the stop agrees by gating", () => {
    const root = newRepo("tlc-e2e-status-");
    writePolicy(root, {
      mode: "heads-down",
      codePaths: ["src"],
      grind: { enabled: true, lintCommand: ["node", "-e", "process.exit(1)"] },
    });
    writeFileSync(join(root, "src", "app.ts"), "export const a = 2;\n");

    const status = JSON.parse(cli(["status", "--json"], root).stdout) as {
      mode: string;
      modeOrigin: string;
      grind: boolean;
    };
    assert.equal(status.mode, "focus");
    assert.equal(status.modeOrigin, "config");
    assert.equal(status.grind, true);

    const stop = hook("stop", cursorStop(root), root);
    assert.match(stop.stdout, /lint failed/, "the stop ran the gate status said was on");
  });

  test("a mode flag overrides the policy and status says the origin is the flag", () => {
    const root = newRepo("tlc-e2e-origin-");
    writePolicy(root, { mode: "heads-down" });
    assert.equal(cli(["mode", "paired"], root).status, 0);
    const status = JSON.parse(cli(["status", "--json"], root).stdout) as {
      mode: string;
      modeOrigin: string;
    };
    assert.equal(status.mode, "paired");
    assert.equal(status.modeOrigin, "file");
  });
});

describe("E2E — CG-03: obs fields reach the runtime", () => {
  test("a project window drops a record the default window keeps", () => {
    const home = mkdtempSync(join(tmpdir(), "tlc-e2e-home-"));
    cleanup.push(home);
    const root = newRepo("tlc-e2e-obs-");
    const spool = join(home, "state", "obs-spool.jsonl");
    mkdirSync(dirname(spool), { recursive: true });
    const ts = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(spool, `${JSON.stringify({ repo: root, project: "p", stream: "obs", record: { ts } })}\n`);

    const kept = JSON.parse(entry("obs-cli.ts", ["prune", "--json"], root, home).stdout) as {
      spoolDropped: number;
    };
    assert.equal(kept.spoolDropped, 0);

    writePolicy(root, { obs: { retentionDays: 1 } });
    writeFileSync(spool, `${JSON.stringify({ repo: root, project: "p", stream: "obs", record: { ts } })}\n`);
    const dropped = JSON.parse(entry("obs-cli.ts", ["prune", "--json"], root, home).stdout) as {
      retentionDays: number;
      spoolDropped: number;
    };
    assert.equal(dropped.retentionDays, 1);
    assert.equal(dropped.spoolDropped, 1);
  });

  // why: TLC_HOME names both where the runtime lives and where the spool goes, so the two cannot be pointed
  // apart. This drives the real runtime and asserts on what the append added — the file is append-only and
  // gitignored, so nothing is disturbed and nothing is deleted.
  test("a hook appends to the spool only once the project opts in", () => {
    const spoolPath = join(repoRoot, "state", "obs-spool.jsonl");
    const lengthBefore = existsSync(spoolPath) ? readFileSync(spoolPath, "utf8").length : 0;
    const root = newRepo("tlc-e2e-spool-");
    const submit = () =>
      hook(
        "prompt-submit",
        {
          hook_event_name: "beforeSubmitPrompt",
          workspace_roots: [root],
          conversation_id: "c",
          session_id: "e2e-spool",
          prompt: "x",
        },
        root,
        { TLC_HOME: repoRoot },
      );

    submit();
    const afterOptOut = existsSync(spoolPath) ? readFileSync(spoolPath, "utf8").length : 0;
    assert.equal(afterOptOut, lengthBefore, "an opted-out project must not append");

    writePolicy(root, { obs: { globalSpool: true } });
    submit();
    const appended = readFileSync(spoolPath, "utf8").slice(lengthBefore);
    assert.match(appended, /"stream":"obs"/);
    assert.ok(appended.includes(root), "the appended record names the repository it came from");
  });
});

describe("E2E — the rails from the previous branch still hold through the launcher", () => {
  test("the plan gate blocks an unplanned file and a justified deviation clears it", () => {
    const root = newRepo("tlc-e2e-plan-");
    writePolicy(root, { planGate: { enabled: true } });
    writeFileSync(join(root, "src", "app.ts"), "export const a = 3;\n");

    const declare = (text: string) =>
      hook(
        "response-after",
        {
          hook_event_name: "afterAgentResponse",
          workspace_roots: [root],
          conversation_id: "e2e",
          session_id: "e2e-1",
          text,
        },
        root,
      );

    declare("HARNESS_PLAN: docs/only.md");
    const blocked = hook("stop", cursorStop(root), root);
    assert.match(blocked.stdout, /outside the declared plan/);
    assert.match(blocked.stdout, /src\/app\.ts/);

    declare("HARNESS_PLAN_DEVIATION: src/app.ts — the fix belongs here");
    const allowed = hook("stop", cursorStop(root), root);
    assert.doesNotMatch(allowed.stdout, /outside the declared plan/);
  });

  test("untrusted framing fires once per turn and ignores a pattern inside a quoted argument", () => {
    const root = newRepo("tlc-e2e-untrusted-");
    writePolicy(root, { untrustedContent: { enabled: true } });
    const shell = (command: string) =>
      hook(
        "tool-after",
        {
          hook_event_name: "afterShellExecution",
          workspace_roots: [root],
          conversation_id: "e2e",
          session_id: "e2e-untrusted",
          command,
        },
        root,
      );

    assert.doesNotMatch(shell('echo "gh pr view 1"').stdout, /UNTRUSTED CONTENT/);
    assert.match(shell("gh pr view 1").stdout, /UNTRUSTED CONTENT/);
    assert.doesNotMatch(shell("gh pr view 2").stdout, /UNTRUSTED CONTENT/);
  });
});
