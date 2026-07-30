import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const skillDir = join(repoRoot, "skills", "harness-init");

function read(...segments: string[]): string {
  return readFileSync(join(...segments), "utf8");
}

function catalogIds(): string[] {
  const catalog = JSON.parse(read(repoRoot, "capabilities", "catalog.json")) as {
    capabilities: { id: string }[];
  };
  return catalog.capabilities.map((capability) => capability.id);
}

// invariant: the menu is generated from the catalog, so the check is a count rather than a word match:
// one table row per capability, no more and no fewer.
test("the generated menu has exactly one row per catalog capability", () => {
  const reference = read(skillDir, "references", "capabilities.md");
  const region = reference.slice(
    reference.indexOf("<!-- generated:capabilities -->"),
    reference.indexOf("<!-- /generated -->"),
  );
  const rows = region.split("\n").filter((line) => /^\| \d+ \| /.test(line));
  assert.equal(rows.length, catalogIds().length);
});

test("the skill states the floor rules, which no capability can switch off", () => {
  const reference = read(skillDir, "references", "capabilities.md");
  for (const rule of [
    "outside-project-destruction",
    "unprovable-destruction",
    "secret-access",
    "history-rewrite",
    "machine-control",
  ]) {
    assert.ok(reference.includes(rule), `floor rule absent from the catalog reference: ${rule}`);
  }
});

test("the skill presents all three comment modes", () => {
  const skill = read(skillDir, "SKILL.md");
  for (const mode of ["off", "declared", "strict"]) {
    assert.match(skill, new RegExp(`\\b${mode}\\b`), mode);
  }
});

// hazard: a provider only reads its own skills directory, and both providers resolve theirs from an
// environment variable. A hardcoded default in the wizard writes hooks nobody reads.
test("the skill resolves provider config directories instead of hardcoding them", () => {
  const skill = read(skillDir, "SKILL.md");
  assert.match(skill, /CURSOR_CONFIG_DIR/);
  assert.match(skill, /CLAUDE_CONFIG_DIR/);
});

test("the skill declares a released version", () => {
  const front = read(skillDir, "SKILL.md").split("---")[1] ?? "";
  const version = /version:\s*([0-9]+)\.([0-9]+)\.([0-9]+)/.exec(front);
  assert.ok(version, "no semver version in the skill frontmatter");
  assert.ok(Number(version[1]) >= 1, "a published skill is at least 1.0.0");
});
