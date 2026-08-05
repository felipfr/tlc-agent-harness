import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// tools/check-suppressions.ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
var DIRECTIVE_PATTERN = /(?:^|\s)(?:\/\/|\/\*|\*|#)?\s*(biome-ignore(?:-all|-start|-end)?|@ts-ignore|@ts-expect-error|@ts-nocheck)\b([^\n]*)/;
var DECLARED_PREFIXES = ["why:", "hazard:", "invariant:"];
var MIN_REASON_WORDS = 4;
function isInComment(text, at) {
  let quote = null;
  for (let index = 0;index < at; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "#" || char === "/" && (text[index + 1] === "/" || text[index + 1] === "*")) {
      return true;
    }
  }
  return quote === null && /^\s*\*/.test(text.slice(0, at));
}
function parseSuppression(file, line, text) {
  const match = DIRECTIVE_PATTERN.exec(text);
  if (!match || match.index === undefined) {
    return null;
  }
  const at = text.indexOf(match[1] ?? "", match.index);
  if (!isInComment(text, at)) {
    return null;
  }
  const directive = match[1] ?? "";
  const tail = (match[2] ?? "").replace(/\*\/\s*$/, "").trim();
  const reason = directive.startsWith("biome-ignore") ? (tail.split(":").slice(1).join(":") ?? "").trim() : tail.replace(/^[:\-\s]+/, "").trim();
  return { file, line, directive, reason };
}
function judge(suppression) {
  const { reason } = suppression;
  if (suppression.directive === "@ts-nocheck") {
    return {
      ...suppression,
      detail: "@ts-nocheck disables a whole file; suppress the single diagnostic instead"
    };
  }
  if (reason.length === 0) {
    return { ...suppression, detail: "no reason given" };
  }
  const lowered = reason.toLowerCase();
  if (!DECLARED_PREFIXES.some((prefix) => lowered.startsWith(prefix))) {
    return {
      ...suppression,
      detail: `the reason must open with ${DECLARED_PREFIXES.join(", ")} — got "${reason.slice(0, 40)}"`
    };
  }
  const body = reason.slice(reason.indexOf(":") + 1).trim();
  if (body.split(/\s+/).filter((word) => word.length > 0).length < MIN_REASON_WORDS) {
    return {
      ...suppression,
      detail: `the reason is ${MIN_REASON_WORDS} words or fewer — say what breaks without the suppression`
    };
  }
  return null;
}
function findSuppressions(files, read = readFileSync) {
  const findings = [];
  for (const file of files) {
    const lines = String(read(file, "utf8")).split(`
`);
    for (const [index, text] of lines.entries()) {
      const suppression = parseSuppression(file, index + 1, text);
      if (suppression === null) {
        continue;
      }
      const finding = judge(suppression);
      if (finding !== null) {
        findings.push(finding);
      }
    }
  }
  return findings;
}
function formatFindings(findings, scanned) {
  if (findings.length === 0) {
    return `check-suppressions: ok (0 unjustified in ${scanned} files)`;
  }
  const lines = findings.map((finding) => `  ${finding.file}:${finding.line}  [${finding.directive}]  ${finding.detail}`);
  return [`check-suppressions: ${findings.length} unjustified suppression(s)`, ...lines].join(`
`);
}
function trackedFiles(cwd) {
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "src/**/*.ts", "bin/*.ts", "tools/*.ts"], { cwd, encoding: "utf8" });
  return output.split(`
`).map((line) => line.trim()).filter((line) => line.length > 0);
}
function main() {
  const cwd = process.cwd();
  const files = trackedFiles(cwd);
  const findings = findSuppressions(files);
  console.log(formatFindings(findings, files.length));
  if (findings.length > 0) {
    process.exitCode = 1;
  }
}
if (__require.main == __require.module) {
  main();
}
export {
  trackedFiles,
  parseSuppression,
  judge,
  isInComment,
  formatFindings,
  findSuppressions,
  DECLARED_PREFIXES
};
