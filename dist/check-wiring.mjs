import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// tools/check-wiring.ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
var UNION_DECLARATION = /export type (\w+)\s*=\s*((?:\s*\|?\s*"[^"]+")+)\s*;/g;
function parseInventories(file, text) {
  const out = [];
  for (const match of text.matchAll(UNION_DECLARATION)) {
    const members = [...(match[2] ?? "").matchAll(/"([^"]+)"/g)].map((member) => member[1]).filter((member) => member !== undefined);
    if (members.length > 0 && match[1]) {
      out.push({ typeName: match[1], file, members });
    }
  }
  return out;
}
function quote(member) {
  return member.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var CONSUMER_CONTEXT = /(?:===|!==|case\s+|includes\(|has\()\s*$/;
var PRODUCER_CONTEXT = /(?::|=>|return\s|\?|(?<![=!<>])=|\(|,|\[)\s*$/;
var CONFIG_FACING = new Map([
  ["AppendFilesMode", "policy.grind.appendFiles, set in .tlc/harness/config.json"],
  ["CommentMode", "policy.comments.mode, set in .tlc/harness/config.json"]
]);
function classifyOccurrence(before) {
  if (CONSUMER_CONTEXT.test(before)) {
    return "consumer";
  }
  return PRODUCER_CONTEXT.test(before) ? "producer" : "ambiguous";
}
function rolesIn(text, member) {
  const needle = `"${member}"`;
  let produced = false;
  let consumed = false;
  let at = text.indexOf(needle);
  while (at >= 0) {
    const role = classifyOccurrence(text.slice(Math.max(0, at - 24), at));
    if (role === "producer") {
      produced = true;
    } else if (role === "consumer") {
      consumed = true;
    }
    at = text.indexOf(needle, at + needle.length);
  }
  return { produced, consumed };
}
function producerPattern(member) {
  return new RegExp(`(?::|=>|return\\s|\\?|(?<![=!<>])=|\\(|,)\\s*"${quote(member)}"`);
}
function consumerPattern(member) {
  return new RegExp(`(?:===|!==|case\\s+|includes\\(|has\\()\\s*"${quote(member)}"`);
}
function findUnwired(inventories, corpus) {
  const findings = [];
  for (const inventory of inventories) {
    if (CONFIG_FACING.has(inventory.typeName)) {
      continue;
    }
    for (const member of inventory.members) {
      const consumedIn = [];
      let produced = false;
      for (const [file, text] of corpus) {
        if (!text.includes(`"${member}"`)) {
          continue;
        }
        const roles = rolesIn(text, member);
        if (roles.produced) {
          produced = true;
        }
        if (roles.consumed) {
          consumedIn.push(file);
        }
      }
      if (consumedIn.length > 0 && !produced) {
        findings.push({
          typeName: inventory.typeName,
          member,
          declaredIn: inventory.file,
          consumedIn
        });
      }
    }
  }
  return findings;
}
function configFacingNote() {
  return [...CONFIG_FACING.entries()].map(([type, reason]) => `  not checked: ${type} — ${reason}`);
}
function formatFindings(findings, memberCount) {
  if (findings.length === 0) {
    return [
      `check-wiring: ${memberCount} declared union members, every consumed member has a producer`,
      ...configFacingNote()
    ].join(`
`);
  }
  const lines = [
    `check-wiring: ${findings.length} of ${memberCount} declared union members are read and never written`,
    ""
  ];
  for (const finding of findings) {
    lines.push(`  ${finding.typeName}.${finding.member}  (declared in ${finding.declaredIn})`);
    for (const file of finding.consumedIn) {
      lines.push(`    read by ${file}`);
    }
    lines.push("    Either write it somewhere, or delete the member and the branches that read it.");
  }
  return lines.join(`
`);
}
function trackedSourceFiles(cwd) {
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "src/**/*.ts", "bin/*.ts", "tools/*.ts"], { cwd, encoding: "utf8" });
  return output.split(`
`).map((line) => line.trim()).filter((line) => line.length > 0 && !line.includes("__test__"));
}
function main() {
  const cwd = process.cwd();
  const files = trackedSourceFiles(cwd);
  const corpus = new Map;
  const inventories = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    corpus.set(file, text);
    inventories.push(...parseInventories(file, text));
  }
  const memberCount = inventories.reduce((total, inventory) => total + inventory.members.length, 0);
  const findings = findUnwired(inventories, corpus);
  const report = formatFindings(findings, memberCount);
  if (findings.length > 0) {
    console.error(report);
    process.exit(1);
  }
  console.log(report);
}
if (__require.main == __require.module) {
  main();
}
export {
  trackedSourceFiles,
  producerPattern,
  parseInventories,
  formatFindings,
  findUnwired,
  consumerPattern,
  classifyOccurrence,
  CONFIG_FACING
};
