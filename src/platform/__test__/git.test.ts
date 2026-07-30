import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { filterCodeTargets, filterTestTargets, listChangedRepoFiles, runCommand } from "../git.ts";

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd });
}

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "git-test-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test"]);
  return dir;
}

describe("listChangedRepoFiles", () => {
  test("returns an empty array when .git is absent, without throwing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "no-git-"));
    await assert.doesNotReject(async () => {
      const result = await listChangedRepoFiles(dir);
      assert.deepEqual(result, []);
    });
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns untracked and modified files in a real repo", async () => {
    const dir = initRepo();
    writeFileSync(join(dir, "committed.ts"), "export const a = 1;\n");
    git(dir, ["add", "committed.ts"]);
    git(dir, ["commit", "-q", "-m", "initial"]);

    writeFileSync(join(dir, "committed.ts"), "export const a = 2;\n");
    writeFileSync(join(dir, "untracked.ts"), "export const b = 2;\n");

    const changed = await listChangedRepoFiles(dir);
    assert.equal(changed.includes("committed.ts"), true);
    assert.equal(changed.includes("untracked.ts"), true);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("filterCodeTargets", () => {
  test("keeps files under configured code path prefixes with known extensions", () => {
    const result = filterCodeTargets(
      ["src/app.ts", "src/app.md", "vendor/lib.ts", "apps/web/index.tsx"],
      ["src", "apps"],
    );
    assert.deepEqual(result, ["src/app.ts", "apps/web/index.tsx"]);
  });

  test("excludes files not under any code path prefix", () => {
    const result = filterCodeTargets(["docs/readme.ts", "scripts/deploy.ts"], ["src", "apps"]);
    assert.deepEqual(result, []);
  });
});

describe("filterTestTargets", () => {
  test("matches .test.ts and .spec.ts files", () => {
    const result = filterTestTargets(["src/foo.test.ts", "src/bar.spec.tsx", "src/foo.ts"]);
    assert.deepEqual(result, ["src/foo.test.ts", "src/bar.spec.tsx"]);
  });
});

describe("runCommand", () => {
  test("returns '(no output captured)' when the command produces no output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-command-"));
    const result = await runCommand(dir, ["node", "-e", ""]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.output, "(no output captured)");
    rmSync(dir, { recursive: true, force: true });
  });

  test("truncates output over 8000 characters, keeping the tail", async () => {
    const dir = mkdtempSync(join(tmpdir(), "run-command-"));
    const result = await runCommand(dir, ["node", "-e", "process.stdout.write('x'.repeat(9000) + 'END')"]);
    assert.equal(result.output.length, 8000);
    assert.equal(result.output.endsWith("END"), true);
    rmSync(dir, { recursive: true, force: true });
  });
});
