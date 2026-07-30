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

type TriggerCase = { query: string; should_trigger: boolean; phrase?: string; note?: string };

function triggerCases(): TriggerCase[] {
  return JSON.parse(read(skillDir, "evals", "trigger_evals.json")) as TriggerCase[];
}

function description(): string {
  const front = read(skillDir, "SKILL.md").split("---")[1] ?? "";
  return front.replace(/\s+/g, " ");
}

// invariant: the phrases live in the description, which is the only thing a provider sees before deciding
// to load the skill. Extracting them here rather than restating them means a reworded description fails
// this test instead of silently drifting away from its own eval cases.
function declaredPhrases(): string[] {
  const said = /Use when the user says (.+?), or wants/.exec(description());
  return (said?.[1] ?? "")
    .split(",")
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length > 0);
}

test("the description still lists the phrases the evals are written against", () => {
  const phrases = declaredPhrases();
  assert.ok(
    phrases.length >= 5,
    `expected the description to name several trigger phrases, got ${phrases.length}`,
  );
});

test("every phrase named in the description is covered by a positive case", () => {
  const positives = triggerCases().filter((testCase) => testCase.should_trigger);
  for (const phrase of declaredPhrases()) {
    const covered = positives.some((testCase) => testCase.query.toLowerCase().includes(phrase.toLowerCase()));
    assert.ok(covered, `no positive eval case exercises the declared phrase: ${phrase}`);
  }
});

test("policy-with-trade-offs is exercised, since it triggers without the word harness", () => {
  const positives = triggerCases().filter((testCase) => testCase.should_trigger);
  assert.ok(
    positives.some((testCase) => testCase.phrase === "policy"),
    "no positive case covers the policy/trade-offs trigger",
  );
});

test("each non-goal in the description has a negative case sending it elsewhere", () => {
  const negatives = triggerCases().filter((testCase) => !testCase.should_trigger);
  const text = description();
  for (const nonGoal of ["status", "help", "grind", "metrics"]) {
    assert.ok(text.includes(nonGoal), `the description no longer names the non-goal: ${nonGoal}`);
    const covered = negatives.some((testCase) =>
      `${testCase.query} ${testCase.note ?? ""}`.toLowerCase().includes(nonGoal),
    );
    assert.ok(covered, `no negative eval case covers the non-goal: ${nonGoal}`);
  }
});

test("every eval case is well formed, so a typo cannot pass as a silent skip", () => {
  const cases = triggerCases();
  assert.ok(cases.length >= 10, "too few cases to say anything about routing");
  for (const testCase of cases) {
    assert.equal(typeof testCase.query, "string");
    assert.ok(testCase.query.trim().length > 0);
    assert.equal(typeof testCase.should_trigger, "boolean");
  }
  assert.ok(
    cases.some((testCase) => !testCase.should_trigger),
    "an eval set with no negative case cannot detect over-triggering",
  );
});

test("the skill declares a released version", () => {
  const front = read(skillDir, "SKILL.md").split("---")[1] ?? "";
  const version = /version:\s*([0-9]+)\.([0-9]+)\.([0-9]+)/.exec(front);
  assert.ok(version, "no semver version in the skill frontmatter");
  assert.ok(Number(version[1]) >= 1, "a published skill is at least 1.0.0");
});
