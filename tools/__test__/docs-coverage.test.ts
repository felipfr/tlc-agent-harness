import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function normalize(text: string): string {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function steeringSection(): string {
  const doc = readFileSync(join(repoRoot, "docs", "architecture.md"), "utf8");
  const start = doc.indexOf("## Steering pillars");
  assert.ok(start !== -1, "architecture.md has no steering pillars section");
  const end = doc.indexOf("\n## ", start + 1);
  return doc.slice(start, end === -1 ? undefined : end);
}

// hazard: the floor is the part an operator cannot turn off, so omitting a rule from the docs turns its
// first denial into a mystery.
test("every floor rule appears in the steering pillars section", () => {
  const service = readFileSync(join(repoRoot, "src", "core", "floor", "floor.service.ts"), "utf8");
  const declared = service.slice(
    service.indexOf("export type FloorRule"),
    service.indexOf(";", service.indexOf("export type FloorRule")),
  );
  const rules = [...declared.matchAll(/"([a-z-]+)"/g)].map((match) => match[1] as string);
  assert.ok(rules.length >= 5, `expected the FloorRule union, parsed ${rules.length}`);

  const section = normalize(steeringSection());
  const missing = rules.filter((rule) => !section.includes(normalize(rule)));
  assert.deepEqual(missing, []);
});

// hazard: the floor is what a reader must know before the first denial, so the entry document has to
// carry it. It was absent from the README while being the most distinctive behaviour in the product.
test("the README names every floor rule", () => {
  const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
  const service = readFileSync(join(repoRoot, "src", "core", "floor", "floor.service.ts"), "utf8");
  const start = service.indexOf("export type FloorRule");
  const declared = service.slice(start, service.indexOf(";", start));
  const rules = [...declared.matchAll(/"([a-z-]+)"/g)].map((match) => match[1] as string);
  const missing = rules.filter((rule) => !readme.includes(rule));
  assert.deepEqual(missing, []);
});

test("the generator owns only its region, and detects a change inside it", async () => {
  const { renderAll, replaceRegion } = await import("../render-capabilities.ts");
  const results = renderAll();
  assert.equal(results.length, 2);
  for (const result of results) {
    assert.equal(result.current, result.next, `${result.file} is out of date with the catalog`);
  }

  const sample = "before\n<!-- generated:rails -->\nOLD\n<!-- /generated -->\nafter\n";
  const replaced = replaceRegion(sample, "rails", "NEW");
  assert.match(replaced, /before/);
  assert.match(replaced, /after/);
  assert.match(replaced, /NEW/);
  assert.doesNotMatch(replaced, /OLD/);
});

test("a missing region marker is an error, not a silent no-op", async () => {
  const { replaceRegion } = await import("../render-capabilities.ts");
  assert.throws(() => replaceRegion("no markers here", "rails", "x"), /missing region marker/);
});

// hazard: the README states a capability count in prose. It was already one behind the catalog when this
// test was written, so the number is asserted against the catalog rather than trusted.
test("the README's capability count matches the catalog", () => {
  const catalog = JSON.parse(readFileSync(join(repoRoot, "capabilities", "catalog.json"), "utf8")) as {
    capabilities: unknown[];
  };
  const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
  const stated = /opt-in: (\d+) capabilities/.exec(readme);
  assert.ok(stated, "the README no longer states a capability count");
  assert.equal(
    Number(stated[1]),
    catalog.capabilities.length,
    "the README's capability count drifted from capabilities/catalog.json",
  );
});
