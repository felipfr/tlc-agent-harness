import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * hazard: a refusal has two audiences and one of them cannot act. `reason` becomes the agent message; `userNote`
 * becomes the operator's. Twice now an agent-facing refusal has instructed the agent to run a harness command that
 * the floor refuses from inside a session — once in the policy-surface guard (fixed under AD-026) and once in the
 * integrity check, where it cost a colleague's session two wasted rounds and a full stop.
 *
 * invariant: no `reason` string instructs a mutating harness subcommand. A `userNote` may, because the operator is
 * the one who can run it. This sweep exists so a third instance fails here rather than in someone's session
 * ([/decisions/ad-030.md](/decisions/ad-030.md)).
 */
const MUTATING = ["pause", "resume", "grind", "mode", "init", "gate", "policy"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.name === "__test__" || entry.name === "node_modules") {
      continue;
    }
    if (entry.isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (entry.name.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

/**
 * why: a line-scoped scan rather than an AST walk. It reads the `reason:` property's own line and the continuation
 * lines of its array literal, which is the shape every refusal in this codebase uses. A comment mentioning the
 * command is not a refusal, so comment lines are skipped.
 */
function reasonLines(text: string): string[] {
  const lines = text.split("\n");
  const collected: string[] = [];
  let inReason = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) {
      continue;
    }
    if (/\breason:\s*\[/.test(trimmed)) {
      inReason = true;
      continue;
    }
    if (inReason) {
      if (trimmed.startsWith("]")) {
        inReason = false;
        continue;
      }
      collected.push(trimmed);
      continue;
    }
    if (/\breason:/.test(trimmed)) {
      collected.push(trimmed);
    }
  }
  return collected;
}

test("no agent-facing refusal instructs a harness command the floor refuses", () => {
  const files = [
    ...sourceFiles(join(repoRoot, "src", "core")),
    ...sourceFiles(join(repoRoot, "src", "entrypoints")),
  ];
  assert.ok(files.length > 30, `expected the source tree, walked ${files.length}`);

  const offences: string[] = [];
  let scanned = 0;
  for (const file of files) {
    for (const line of reasonLines(readFileSync(file, "utf8"))) {
      scanned += 1;
      for (const sub of MUTATING) {
        // why: matches the instruction shape, not any mention. "tlc harness pause" inside a reason is an
        // instruction; "the harness commands" is prose and already covered by its own assertion below.
        if (line.includes(`tlc harness ${sub}`)) {
          offences.push(`${file.replace(`${repoRoot}/`, "")}: ${line.slice(0, 110)}`);
        }
      }
    }
  }
  // why: asserts the sweep actually read something. A scan that matches nothing because it parsed nothing passes
  // forever, which is how this class of test rots.
  assert.ok(scanned > 20, `expected to scan real reason strings, found ${scanned}`);
  assert.deepEqual(offences, []);
});

test("the sweep would catch the exact string that shipped", () => {
  const planted = [
    "      reason: [",
    '        "HARNESS: policy changed.",',
    '        "Run tlc harness policy accept to clear it.",',
    "      ],",
  ].join("\n");
  const found = reasonLines(planted).some((line) => line.includes("tlc harness policy"));
  assert.equal(found, true, "the sweep must see an instruction inside a reason array");
});

test("the sweep ignores the same text in a comment, which is not a refusal", () => {
  const commented = [
    "      // run tlc harness policy accept to clear it",
    '      reason: "something else",',
  ].join("\n");
  assert.equal(
    reasonLines(commented).some((line) => line.includes("tlc harness policy")),
    false,
  );
});

test("every scanned path is a file, so a directory rename cannot silently empty the sweep", () => {
  for (const dir of [join(repoRoot, "src", "core"), join(repoRoot, "src", "entrypoints")]) {
    assert.ok(statSync(dir).isDirectory(), dir);
  }
});
