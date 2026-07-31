import { relative, resolve } from "node:path";
import { projectConfigPath, projectStateDir } from "../../platform/paths.ts";
import { normalizeSeparators } from "../../platform/sanitize.ts";
import { isInside, isPolicySurface, resolveTarget } from "./floor.paths.ts";
import {
  type HeredocChunk,
  heredocChunks,
  type ShellSegment,
  type ShellWord,
  tokenizeShell,
} from "./floor.tokenize.ts";
import { firstOperand, verbOf } from "./floor.verb.ts";

export type PolicySurfaceVerdict = { kind: "allow" } | { kind: "deny"; detail: string; note: string };

const ALLOW: PolicySurfaceVerdict = { kind: "allow" };

// invariant: this is an allowlist on purpose. The set of ways a shell can write a file is unbounded —
// `python3 -c`, `perl -pi`, `ex`, any interpreter — so enumerating writers guarantees a hole. Enumerating
// the readers instead means an unknown verb lands on the deny side without anyone having to predict it.
// hazard: `awk` and `sort` look like readers and are not — `awk '{print > f}'` and `sort -o f` both write a
// file the head verb never reveals. They are left out deliberately.
const PROVEN_READERS = new Set([
  "cat",
  "cmp",
  "diff",
  "echo",
  "file",
  "grep",
  "head",
  "jq",
  "less",
  "ls",
  "md5sum",
  "more",
  "od",
  "printf",
  "rg",
  "sha256sum",
  "stat",
  "strings",
  "tail",
  "wc",
  "xxd",
]);

// hazard: `git checkout -- <path>`, `git restore` and `git apply` overwrite the working tree, so `git` as a
// whole cannot be a reader. Only the subcommands that provably do not write are allowed.
const GIT_READERS = new Set(["show", "diff", "log", "status", "ls-files", "cat-file", "blame"]);

// hazard: a heredoc is only a program when the verb it feeds executes what it reads. `git commit -F -` and
// `cat <<EOF` take a heredoc that *documents* this path — commit messages and docs in this repository name
// it constantly — so judging a body by "not a proven reader" denied writing about the rule at all.
const EXECUTES_STDIN = new Set([
  "ash",
  "awk",
  "bash",
  "bun",
  "dash",
  "deno",
  "ed",
  "ex",
  "fish",
  "gawk",
  "ksh",
  "lua",
  "node",
  "perl",
  "php",
  "python",
  "python2",
  "python3",
  "ruby",
  "sed",
  "sh",
  "tclsh",
  "zsh",
]);

const HARNESS_BINS = new Set(["tlc", "tlc.cmd"]);
const MUTATING_SUBCOMMANDS = new Set(["pause", "resume", "grind", "mode", "init", "gate"]);

function deny(detail: string, note: string): PolicySurfaceVerdict {
  return { kind: "deny", detail, note };
}

// why: the harness directory prefix is derived from the path module rather than written as a literal, so a
// change to the on-disk layout cannot leave this rule matching a path that no longer exists. The relative
// form is what appears in commands, and an absolute path contains it too.
function harnessPrefix(projectDir: string): string {
  const state = normalizeSeparators(relative(projectDir, projectStateDir(projectDir)));
  return state.slice(0, state.lastIndexOf("/"));
}

// hazard: the incident's command hid the path inside `python3 -c "...open('.tlc/harness/config.json','w')"`,
// which tokenizes as one word that resolves to nothing. Reasoning about the nested quoting is the
// weak-parser trap the floor refuses elsewhere, so the text is only asked whether the surface is named at
// all — and that question is only asked of verbs that were not proven to be readers.
function namesSurface(projectDir: string, segment: ShellSegment): boolean {
  const text = normalizeSeparators(segment.words.map((word) => word.text).join(" "));
  return text.includes(harnessPrefix(projectDir));
}

// why: the surface and the target overlap when either contains the other. Containment in the second
// direction is what catches `rm -rf .tlc/harness/state`, which removes the flags without ever naming one.
// hazard: the project root also contains the surface. Counting it would deny `find .` and `grep -r x .`,
// so the root is excluded and destruction of the whole project stays the concern of the existing rules.
function overlapsSurface(projectDir: string, resolved: string): boolean {
  if (resolved === resolve(projectDir)) {
    return false;
  }
  if (isPolicySurface(projectDir, resolved)) {
    return true;
  }
  return [projectConfigPath(projectDir), projectStateDir(projectDir)].some(
    (surface) => isInside(surface, resolved) || isInside(resolved, surface),
  );
}

function referencesSurface(projectDir: string, word: ShellWord): boolean {
  if (word.text === "") {
    return false;
  }
  // hazard: an unresolved word carries a `$var` or `$(...)`, so its value is unknowable here. Matching the
  // literal portion catches `> .tlc/harness/$f`; a fully computed path stays out of reach and is what the
  // per-session integrity baseline exists to catch.
  if (word.unresolved) {
    return normalizeSeparators(word.text).includes(harnessPrefix(projectDir));
  }
  return overlapsSurface(projectDir, resolveTarget(projectDir, word.text));
}

// why: a redirect target is not an argument of the head verb, so argument scanning alone would allow
// `cat x > config.json` — the head verb there is a proven reader. Both the spaced and the attached forms
// have to be read, because `>f`, `>>f` and `x>f` all tokenize as a single word.
function redirectTargets(words: ShellWord[]): ShellWord[] {
  const targets: ShellWord[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!word) {
      continue;
    }
    const match = /^(.*?)>{1,2}\|?(.*)$/s.exec(word.text);
    if (!match) {
      continue;
    }
    const attached = match[2] ?? "";
    if (attached !== "") {
      targets.push({ text: attached, unresolved: word.unresolved });
      continue;
    }
    const next = words[index + 1];
    if (next) {
      targets.push(next);
      index += 1;
    }
  }
  return targets;
}

function harnessSubcommand(args: ShellWord[]): string | null {
  const operands = args.filter((word) => !word.text.startsWith("-") && word.text !== "");
  if (operands[0]?.text.toLowerCase() !== "harness") {
    return null;
  }
  // why: `route()` defaults a missing subcommand to `status`, so bare `tlc harness` reads state and is
  // not a mutation.
  return (operands[1]?.text ?? "status").toLowerCase();
}

function checkSegment(projectDir: string, segment: ShellSegment): PolicySurfaceVerdict {
  for (const target of redirectTargets(segment.words)) {
    if (referencesSurface(projectDir, target)) {
      return deny(
        "a redirect in this command writes into the harness policy surface.",
        "redirect into the policy surface",
      );
    }
  }

  const head = verbOf(segment.words);

  if (head && HARNESS_BINS.has(head.verb)) {
    const subcommand = harnessSubcommand(head.args);
    if (subcommand !== null && MUTATING_SUBCOMMANDS.has(subcommand)) {
      return deny(
        `\`tlc harness ${subcommand}\` changes harness policy, and policy is the operator's to change.`,
        `tlc harness ${subcommand}`,
      );
    }
  }

  const references = segment.words.filter((word) => referencesSurface(projectDir, word));
  if (references.length === 0 && !namesSurface(projectDir, segment)) {
    return ALLOW;
  }

  // hazard: an unreliable split means the head verb is not established, so a reader-looking head proves
  // nothing. Unknown resolves to denied, as it does for the destruction rules.
  if (segment.opaque) {
    return deny(
      "this command names the harness policy surface inside a segment this gate cannot split, so what it does to it cannot be established.",
      "unprovable policy-surface access",
    );
  }
  if (!head) {
    return deny(
      "the harness policy surface is named in a command with no resolvable verb.",
      "policy-surface access with no verb",
    );
  }
  // why: a proven reader is cleared before any other question, because reading the policy is ordinary work
  // and the bootstrap asks for it by name. Nothing in this set can write a file on its own.
  if (PROVEN_READERS.has(head.verb)) {
    return ALLOW;
  }
  if (head.verb === "git") {
    const subcommand = firstOperand(head.args)?.text.toLowerCase() ?? "";
    return GIT_READERS.has(subcommand)
      ? ALLOW
      : deny(
          `\`git ${subcommand}\` can write the working tree, so it cannot be proven to only read the harness policy surface.`,
          `git ${subcommand} on the policy surface`,
        );
  }
  if (references.some((word) => word.unresolved)) {
    return deny(
      "this command builds a harness policy path at runtime, so the file it would touch cannot be established.",
      "unresolvable policy-surface path",
    );
  }
  return deny(
    `\`${head.verb}\` is not a proven reader, so this command cannot be shown to only read the harness policy surface.`,
    `${head.verb} on the policy surface`,
  );
}

// hazard: `python3 - <<PY` puts the program in the heredoc body, so the path never appears among the words.
// The body only matters when something executes it: `git commit -F -` and `cat <<EOF` receive heredocs that
// merely name this path, which is what writing about the rule looks like. A heredoc that *writes* the
// surface through a redirect or a path argument is caught by the per-segment rules instead.
function checkHeredocs(projectDir: string, heredocs: HeredocChunk[]): PolicySurfaceVerdict {
  const prefix = harnessPrefix(projectDir);
  for (const chunk of heredocs) {
    if (!normalizeSeparators(chunk.body).includes(prefix)) {
      continue;
    }
    // hazard: the body belongs to the verb immediately before its marker, not to the command. Asking
    // whether *any* segment runs an interpreter denied `cat >> f <<EOF ... ; node --test`, where the body
    // goes to cat and node is a separate command.
    const owner = verbOf(tokenizeShell(chunk.prefix).at(-1)?.words ?? []);
    if (owner !== null && EXECUTES_STDIN.has(owner.verb)) {
      return deny(
        `a heredoc fed to \`${owner.verb}\` names the harness policy surface, so the body is a program rather than a document.`,
        "heredoc program naming the policy surface",
      );
    }
  }
  return ALLOW;
}

// invariant: reads no policy. It answers from paths, head verbs and the command's own text, so the file it
// protects can never influence the decision that protects it.
export function checkPolicySurface(
  projectDir: string,
  command: string,
  segments: ShellSegment[],
): PolicySurfaceVerdict {
  for (const segment of segments) {
    const verdict = checkSegment(projectDir, segment);
    if (verdict.kind === "deny") {
      return verdict;
    }
  }
  return checkHeredocs(projectDir, heredocChunks(command));
}
