import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  bootDir,
  flagsDir,
  loopsDir,
  presenceDir,
  projectConfigPath,
  projectStateDir,
  runtimeHome,
} from "../paths.ts";

describe("runtimeHome", () => {
  const original = process.env.TLC_HOME;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.TLC_HOME;
    } else {
      process.env.TLC_HOME = original;
    }
  });

  test("resolves under os.homedir()/.tlc/harness by default", () => {
    delete process.env.TLC_HOME;
    assert.equal(runtimeHome(), join(homedir(), ".tlc", "harness"));
  });

  test("honors TLC_HOME override", () => {
    process.env.TLC_HOME = "/custom/tlc-home";
    assert.equal(runtimeHome(), "/custom/tlc-home");
  });

  test("contains no .cursor string", () => {
    delete process.env.TLC_HOME;
    assert.equal(runtimeHome().includes(".cursor"), false);
  });
});

describe("project paths", () => {
  test("projectConfigPath resolves to <root>/.tlc/harness/config.json", () => {
    assert.equal(projectConfigPath("/repo"), join("/repo", ".tlc", "harness", "config.json"));
  });

  test("projectStateDir resolves to <root>/.tlc/harness/state", () => {
    assert.equal(projectStateDir("/repo"), join("/repo", ".tlc", "harness", "state"));
  });

  test("flagsDir, presenceDir, loopsDir, bootDir nest under the project state dir", () => {
    const state = projectStateDir("/repo");
    assert.equal(flagsDir("/repo"), join(state, "flags"));
    assert.equal(presenceDir("/repo"), join(state, "presence"));
    assert.equal(loopsDir("/repo"), join(state, "loops"));
    assert.equal(bootDir("/repo"), join(state, "boot"));
  });

  test("TLC_HOME override does not affect project paths", () => {
    const original = process.env.TLC_HOME;
    process.env.TLC_HOME = "/custom/tlc-home";
    try {
      assert.equal(projectConfigPath("/repo"), join("/repo", ".tlc", "harness", "config.json"));
    } finally {
      if (original === undefined) {
        delete process.env.TLC_HOME;
      } else {
        process.env.TLC_HOME = original;
      }
    }
  });

  test("no .cursor string in any project path", () => {
    assert.equal(projectConfigPath("/repo").includes(".cursor"), false);
    assert.equal(projectStateDir("/repo").includes(".cursor"), false);
  });
});

test("source file contains zero occurrences of process.env.HOME", () => {
  const source = readFileSync(fileURLToPath(new URL("../paths.ts", import.meta.url)), "utf8");
  assert.equal(/process\.env\.HOME\b/.test(source), false);
});
