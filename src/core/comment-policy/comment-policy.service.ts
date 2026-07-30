import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddedLine } from "../../platform/git.ts";
import { listAddedLines } from "../../platform/git.ts";
import type { CommentMode } from "../policy/policy.types.ts";
import type { CommentFinding } from "./comment-policy.types.ts";

const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*(?![*/])|#)/;
const SLASH_COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*(?![*/]))/;
// hazard: `#` starts a comment in shell and Python but not in TS, where it starts a private field —
// and markdown inside a template literal made `## Heading` read as seven added comments.
const HASH_COMMENT_EXTENSIONS = [
  ".bash",
  ".cfg",
  ".conf",
  ".ini",
  ".py",
  ".sh",
  ".toml",
  ".yaml",
  ".yml",
  ".zsh",
];

function hashStartsComment(file: string): boolean {
  const lower = file.toLowerCase();
  return HASH_COMMENT_EXTENSIONS.some((extension) => lower.endsWith(extension)) || !lower.includes(".");
}
const TOOL_DIRECTIVE =
  /^\s*(?:\/\/|\/\*|\*|#)\s*(?:biome-ignore|eslint|@ts-|prettier-ignore|noqa|type:|shellcheck|!)/;
const DECLARED_REASON = /^\s*(?:\/\/|\/\*|\*|#)\s*(?:why|hazard|invariant):\s*\S/i;
const CLOSER_OR_CONTINUATION = /^\s*(?:\*\/|\*|\/\/)/;

export const COMMENT_MARKERS = ["why:", "hazard:", "invariant:"] as const;

export function isCommentLine(text: string, file = ""): boolean {
  const pattern = file !== "" && !hashStartsComment(file) ? SLASH_COMMENT_LINE : COMMENT_LINE;
  return pattern.test(text) && !TOOL_DIRECTIVE.test(text);
}

export function declaresReason(text: string): boolean {
  return DECLARED_REASON.test(text);
}

const DECLARATION =
  /^\s*(?:(?:export|declare|public|private|protected|readonly|static|async|abstract)\s+)*(?:class|function|const|let|var|type|interface|enum|namespace)\s+([A-Za-z_$][\w$]*)|^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\??\s*[:(<]/;

// invariant: attachment is decided by position, the same way every JSDoc tool decides it. A `/** */`
// floating inside a function body documents nothing, so it is judged as an inline comment instead.
export function attachedIdentifier(codeLine: string | undefined): string | null {
  const match = codeLine === undefined ? null : DECLARATION.exec(codeLine);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "get",
  "gets",
  "has",
  "in",
  "into",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "return",
  "returns",
  "set",
  "sets",
  "that",
  "the",
  "then",
  "this",
  "to",
  "true",
  "when",
  "which",
  "with",
]);

function words(text: string): string[] {
  return text
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1);
}

export const MIN_INFORMATIVE_WORDS = 3;

// invariant: a doc comment addresses the caller, so the question is whether it carries information the
// identifier does not. Exempting the form outright would make `/** */` an escape hatch.
export function isInformativeDoc(commentText: string, identifier: string): boolean {
  const named = new Set(words(identifier));
  const remaining = words(commentText.replace(/^[\s/*]+|[\s*/]+$/g, "")).filter(
    (word) => !named.has(word) && !STOPWORDS.has(word),
  );
  return new Set(remaining).size >= MIN_INFORMATIVE_WORDS;
}

// invariant: a marker sits on the first line of a comment, so continuation lines are part of the same
// block and are not judged on their own.
export function groupCommentBlocks(added: AddedLine[]): AddedLine[][] {
  const blocks: AddedLine[][] = [];
  let block: AddedLine[] = [];

  for (const line of added) {
    if (!isCommentLine(line.text, line.file)) {
      block = [];
      continue;
    }
    const previous = block.at(-1);
    if (previous && previous.file === line.file && previous.line === line.line - 1) {
      block.push(line);
      continue;
    }
    block = [line];
    blocks.push(block);
  }

  return blocks;
}

// hazard: judging by the head alone lets one marker cover any length of text below it.
export const MAX_DECLARED_LINES = 4;

export type NextCodeLine = (file: string, line: number) => string | undefined;

type Verdict = { violates: boolean; reason: string };

// hazard: `*/` is not a comment line, so a block ends one line before its closer. The lookup skips the
// closer and any continuation line to reach the declaration, here rather than in each resolver.
function declarationAfter(file: string, tailLine: number, nextCodeLine: NextCodeLine): string | undefined {
  for (let line = tailLine + 1; line <= tailLine + 4; line += 1) {
    const text = nextCodeLine(file, line);
    if (text === undefined) {
      continue;
    }
    if (text.trim() === "" || CLOSER_OR_CONTINUATION.test(text)) {
      continue;
    }
    return text;
  }
  return undefined;
}

function judge(block: AddedLine[], mode: CommentMode, nextCodeLine?: NextCodeLine): Verdict {
  const head = block[0] as AddedLine;
  const tail = block.at(-1) as AddedLine;

  if (head.text.trimStart().startsWith("/**") && nextCodeLine) {
    const identifier = attachedIdentifier(declarationAfter(head.file, tail.line, nextCodeLine));
    if (identifier !== null) {
      const body = block.map((line) => line.text).join(" ");
      if (mode === "strict") {
        return { violates: true, reason: "comment added this turn" };
      }
      return isInformativeDoc(body, identifier)
        ? { violates: false, reason: "" }
        : { violates: true, reason: `doc comment only restates ${identifier}` };
    }
  }

  if (mode === "strict") {
    return { violates: true, reason: "comment added this turn" };
  }
  if (!declaresReason(head.text)) {
    return { violates: true, reason: "undeclared comment added this turn" };
  }
  if (block.length > MAX_DECLARED_LINES) {
    return { violates: true, reason: `declared comment runs past ${MAX_DECLARED_LINES} lines` };
  }
  return { violates: false, reason: "" };
}

export function findAddedComments(
  added: AddedLine[],
  mode: CommentMode = "declared",
  nextCodeLine?: NextCodeLine,
): CommentFinding[] {
  const findings: CommentFinding[] = [];
  for (const block of groupCommentBlocks(added)) {
    if (block[0] === undefined) {
      continue;
    }
    const verdict = judge(block, mode, nextCodeLine);
    if (verdict.violates) {
      const head = block[0];
      findings.push({
        file: head.file,
        line: head.line,
        reason: verdict.reason,
        text: head.text.trim().slice(0, 120),
      });
    }
  }
  return findings;
}

// hazard: documenting an existing export touches only the comment, so the declaration it attaches to is
// absent from the diff and has to be read from disk.
function diskLineReader(projectDir: string): NextCodeLine {
  const cache = new Map<string, string[]>();
  return (file, line) => {
    let lines = cache.get(file);
    if (lines === undefined) {
      try {
        lines = readFileSync(join(projectDir, file), "utf8").split("\n");
      } catch {
        lines = [];
      }
      cache.set(file, lines);
    }
    return lines[line - 1];
  };
}

export async function scanAddedComments(
  projectDir: string,
  relativePaths: string[],
  mode: CommentMode = "declared",
): Promise<CommentFinding[]> {
  const added = await listAddedLines(projectDir, relativePaths);
  return findAddedComments(added, mode, diskLineReader(projectDir));
}

export function commentViolationMessage(hits: CommentFinding[], mode: CommentMode = "declared"): string {
  const need =
    mode === "strict"
      ? [
          "NEED: delete every line below. This project does not accept agent-added comments.",
          "If one is genuinely warranted, say so in your reply and let the operator write it.",
        ]
      : [
          `NEED: delete each line below, or restate it as ${COMMENT_MARKERS.join(" / ")} when it`,
          "records a non-obvious why, a hazard, or an external constraint. Narrating what the code",
          "does is not a reason.",
        ];
  return [
    `BLOCKED: this turn added ${hits.length} comment(s).`,
    "TRIED: compared added lines against HEAD; pre-existing comments are never counted.",
    "Each entry is one comment, reported at its first line.",
    ...need,
    "Tool directives (biome-ignore, @ts-, noqa, shellcheck, shebang) are exempt.",
    "",
    ...hits.slice(0, 20).map((h) => `${h.file}:${h.line}  ${h.text}`),
  ].join("\n");
}
