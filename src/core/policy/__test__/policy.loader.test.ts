import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { flagsDir, projectConfigPath, projectStateDir } from "../../../platform/paths.ts";
import { DEFAULTS } from "../policy.defaults.ts";
import { isUnderCodePaths, loadPolicy } from "../policy.loader.ts";
import { forProvider } from "../policy.types.ts";

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), "tlc-policy-"));
}

function withTlcHome<T>(homeDir: string, fn: () => T): T {
  const previous = process.env.TLC_HOME;
  process.env.TLC_HOME = homeDir;
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env.TLC_HOME;
    } else {
      process.env.TLC_HOME = previous;
    }
  }
}

function writeProjectConfig(root: string, patch: Record<string, unknown>): void {
  const path = projectConfigPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(patch));
}

function writeFlag(root: string, name: string): void {
  const dir = flagsDir(root);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), "");
}

function writeModeFile(root: string, content: string): void {
  const dir = projectStateDir(root);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "harness-mode"), content);
}

test("loadPolicy with no files returns the default policy", () => {
  const root = tempRoot();
  const home = tempRoot();
  try {
    withTlcHome(home, () => {
      const policy = loadPolicy(root);
      assert.equal(policy.mode, "solo");
      assert.equal(policy.subagents.minEffort, null);
      assert.deepEqual(policy.grind, DEFAULTS.grind);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("project config overrides a field while preserving unrelated nested defaults", () => {
  const root = tempRoot();
  const home = tempRoot();
  try {
    withTlcHome(home, () => {
      writeProjectConfig(root, { shipGate: { enabled: true } });
      const policy = loadPolicy(root);
      assert.equal(policy.shipGate.enabled, true);
      assert.equal(policy.shipGate.claimWindowMinutes, DEFAULTS.shipGate.claimWindowMinutes);
      assert.deepEqual(policy.grind, DEFAULTS.grind);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("project config wins over user config on conflicting fields", () => {
  const root = tempRoot();
  const home = tempRoot();
  try {
    withTlcHome(home, () => {
      mkdirSync(home, { recursive: true });
      writeFileSync(join(home, "config.json"), JSON.stringify({ codePaths: ["from-user"] }));
      writeProjectConfig(root, { codePaths: ["from-project"] });
      const policy = loadPolicy(root);
      assert.deepEqual(policy.codePaths, ["from-project"]);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("a field absent from project config still inherits from user config", () => {
  const root = tempRoot();
  const home = tempRoot();
  try {
    withTlcHome(home, () => {
      mkdirSync(home, { recursive: true });
      writeFileSync(join(home, "config.json"), JSON.stringify({ codePaths: ["from-user"] }));
      writeProjectConfig(root, { shipGate: { enabled: true } });
      const policy = loadPolicy(root);
      assert.deepEqual(policy.codePaths, ["from-user"]);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("allowedModels as a bare array applies to every provider", () => {
  const root = tempRoot();
  const home = tempRoot();
  try {
    withTlcHome(home, () => {
      writeProjectConfig(root, { subagents: { allowedModels: ["model-x"] } });
      const policy = loadPolicy(root);
      assert.deepEqual(forProvider(policy.subagents.allowedModels, "provider-a"), ["model-x"]);
      assert.deepEqual(forProvider(policy.subagents.allowedModels, "provider-b"), ["model-x"]);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("allowedModels as a provider-keyed object leaves an absent provider unrestricted", () => {
  const root = tempRoot();
  const home = tempRoot();
  try {
    withTlcHome(home, () => {
      writeProjectConfig(root, { subagents: { allowedModels: { "provider-a": ["model-x"] } } });
      const policy = loadPolicy(root);
      assert.deepEqual(forProvider(policy.subagents.allowedModels, "provider-a"), ["model-x"]);
      assert.equal(forProvider(policy.subagents.allowedModels, "provider-b"), null);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("minEffort defaults to null", () => {
  const root = tempRoot();
  const home = tempRoot();
  try {
    withTlcHome(home, () => {
      assert.equal(loadPolicy(root).subagents.minEffort, null);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("minEffort is overridable via project config", () => {
  const root = tempRoot();
  const home = tempRoot();
  try {
    withTlcHome(home, () => {
      writeProjectConfig(root, { subagents: { minEffort: "high" } });
      assert.equal(loadPolicy(root).subagents.minEffort, "high");
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("a valid harness-mode state file overrides the configured mode", () => {
  const root = tempRoot();
  const home = tempRoot();
  try {
    withTlcHome(home, () => {
      writeModeFile(root, "paired\n");
      assert.equal(loadPolicy(root).mode, "paired");
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("an invalid harness-mode state file is ignored", () => {
  const root = tempRoot();
  const home = tempRoot();
  try {
    withTlcHome(home, () => {
      writeModeFile(root, "not-a-mode");
      assert.equal(loadPolicy(root).mode, "solo");
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("the heads-down flag sets mode to heads-down", () => {
  const root = tempRoot();
  const home = tempRoot();
  try {
    withTlcHome(home, () => {
      writeFlag(root, "heads-down");
      assert.equal(loadPolicy(root).mode, "heads-down");
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("the paired flag sets mode to paired when heads-down is absent", () => {
  const root = tempRoot();
  const home = tempRoot();
  try {
    withTlcHome(home, () => {
      writeFlag(root, "paired");
      assert.equal(loadPolicy(root).mode, "paired");
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("the heads-down flag takes priority over the paired flag", () => {
  const root = tempRoot();
  const home = tempRoot();
  try {
    withTlcHome(home, () => {
      writeFlag(root, "heads-down");
      writeFlag(root, "paired");
      assert.equal(loadPolicy(root).mode, "heads-down");
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("the grind-on flag forces grind.enabled", () => {
  const root = tempRoot();
  const home = tempRoot();
  try {
    withTlcHome(home, () => {
      writeFlag(root, "grind-on");
      assert.equal(loadPolicy(root).grind.enabled, true);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("heads-down mode forces grind.enabled even without the grind-on flag", () => {
  const root = tempRoot();
  const home = tempRoot();
  try {
    withTlcHome(home, () => {
      writeFlag(root, "heads-down");
      assert.equal(loadPolicy(root).grind.enabled, true);
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("two loads with different project overrides do not leak state into each other", () => {
  const rootA = tempRoot();
  const rootB = tempRoot();
  const home = tempRoot();
  try {
    withTlcHome(home, () => {
      writeProjectConfig(rootA, { subagents: { allowedModels: ["model-a"] } });
      writeProjectConfig(rootB, { subagents: { allowedModels: ["model-b"] } });
      const policyA = loadPolicy(rootA);
      const policyB = loadPolicy(rootB);
      assert.deepEqual(policyA.subagents.allowedModels, ["model-a"]);
      assert.deepEqual(policyB.subagents.allowedModels, ["model-b"]);
      assert.deepEqual(DEFAULTS.subagents.allowedModels, []);
    });
  } finally {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("isUnderCodePaths matches an exact segment and a nested path, normalizing separators", () => {
  assert.equal(isUnderCodePaths("src", ["src", "apps"]), true);
  assert.equal(isUnderCodePaths("src/core/foo.ts", ["src", "apps"]), true);
  assert.equal(isUnderCodePaths("src\\core\\foo.ts", ["src", "apps"]), true);
  assert.equal(isUnderCodePaths("docs/readme.md", ["src", "apps"]), false);
});
