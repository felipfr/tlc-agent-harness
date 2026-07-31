import type { Decision } from "../../contracts/decision.ts";
import { isInside, isScratch, isSecretPath, resolveTarget } from "./floor.paths.ts";
import { checkPolicySurface } from "./floor.policy-surface.ts";
import { type ShellSegment, type ShellWord, tokenizeShell } from "./floor.tokenize.ts";
import { verbOf } from "./floor.verb.ts";

export type FloorRule =
  | "machine-control"
  | "secret-access"
  | "unprovable-destruction"
  | "history-rewrite"
  | "outside-project-destruction"
  | "policy-surface-write";

export type FloorInput = {
  projectDir: string;
  toolName?: string | undefined;
  filePath?: string | undefined;
  command?: string | undefined;
  isReadEvent?: boolean | undefined;
};

const DESTRUCTIVE_VERBS = new Set(["dd", "rm", "rmdir", "shred", "truncate"]);
const MACHINE_VERBS = new Set(["halt", "poweroff", "reboot", "shutdown"]);
const READER_VERBS = new Set(["base64", "cat", "head", "less", "more", "od", "strings", "tail", "xxd"]);
const READING_TOOLS = new Set(["Read", "Edit", "MultiEdit", "NotebookEdit"]);
const EXPANDING_VERBS = new Set([".", "eval", "source"]);
const SHELLS = new Set(["ash", "bash", "dash", "fish", "ksh", "sh", "zsh"]);

// why: `bash script.sh` runs a file this gate cannot see, which is a coverage limit rather than evasion.
// `bash -c "..."` carries the command inline, which is the case worth refusing.
function buildsCommandAtRuntime(verb: string, args: ShellWord[]): boolean {
  return EXPANDING_VERBS.has(verb) || (SHELLS.has(verb) && args.some((word) => word.text === "-c"));
}

function reason(rule: FloorRule, detail: string): string {
  return [
    `FLOOR: ${detail}`,
    "This is a floor rule — it has no config switch, because a limit an agent can turn off is not a limit.",
    "Restate what you need and let the operator decide; do not work around this.",
    `rule=${rule}`,
  ].join("\n");
}

function denial(rule: FloorRule, detail: string, note: string): Decision {
  return { kind: "deny", reason: reason(rule, detail), userNote: `Floor rule ${rule}: ${note}` };
}

function isMkfs(verb: string): boolean {
  return verb === "mkfs" || verb.startsWith("mkfs.");
}

function isDangerousVerb(token: string): boolean {
  const verb = token.split("/").pop() ?? token;
  return DESTRUCTIVE_VERBS.has(verb) || MACHINE_VERBS.has(verb) || isMkfs(verb);
}

function hidesDestructiveVerb(segment: ShellSegment): boolean {
  return segment.words.some((word) => word.text.split(/\s+/).some(isDangerousVerb));
}

function pathArgs(args: ShellWord[]): ShellWord[] {
  return args.filter((word) => !word.text.startsWith("-") && word.text !== "");
}

function checkShell(input: FloorInput): Decision {
  const command = input.command;
  if (!command) {
    return { kind: "allow" };
  }

  const segments = tokenizeShell(command);

  for (const segment of segments) {
    const head = verbOf(segment.words);
    if (!head) {
      continue;
    }
    const { verb, args } = head;

    // hazard: `eval "rm -rf /"` and `bash -c "rm -rf /"` build their command at runtime, so the head
    // word does not describe what will run. Reasoning about the nested quoting is the weak-parser
    // trap — refuse the segment instead of interpreting it. Scanning words is only sound here: doing
    // it for any opaque segment flags an `rm` quoted as data somewhere in a long script.
    if (buildsCommandAtRuntime(verb, args) && hidesDestructiveVerb(segment)) {
      return denial(
        "unprovable-destruction",
        "A destructive verb appears inside a command this gate cannot expand, so its target cannot be established. Run it directly with a literal path instead.",
        "hidden destructive verb",
      );
    }

    if (MACHINE_VERBS.has(verb)) {
      return denial("machine-control", `\`${verb}\` controls the machine, not the project.`, verb);
    }

    if (verb === "git" && args.some((word) => word.text === "push")) {
      const forced = args.some((word) => word.text === "--force" || word.text === "-f");
      if (forced) {
        return denial(
          "history-rewrite",
          "`git push --force` discards remote commits that are not in your history. Use --force-with-lease, which refuses when the remote moved.",
          "force push",
        );
      }
    }

    const destructive = DESTRUCTIVE_VERBS.has(verb) || isMkfs(verb);
    if (!destructive) {
      continue;
    }

    const targets = pathArgs(args);

    // hazard: an opaque segment or an unresolved word means the target is unknown. The floor must
    // prove the target is safe, not prove it is dangerous, so unknown resolves to denied.
    if (segment.opaque || targets.some((word) => word.unresolved) || targets.length === 0) {
      return denial(
        "unprovable-destruction",
        `\`${verb}\` was called with a target this gate cannot resolve, so its safety cannot be established. Re-run it with a literal path inside the project.`,
        `unresolvable ${verb}`,
      );
    }

    for (const word of targets) {
      const resolved = resolveTarget(input.projectDir, word.text);
      if (!isInside(input.projectDir, resolved) && !isScratch(resolved)) {
        return denial(
          "outside-project-destruction",
          `\`${verb}\` targets ${resolved}, which is outside the project and outside scratch space.`,
          `${verb} outside project`,
        );
      }
    }
  }

  // hazard: the guard that used to defend this surface keyed off tool names, so a single shell line went
  // around it. The rule belongs here, where the decision is made before any policy is read.
  const surface = checkPolicySurface(input.projectDir, command, segments);
  if (surface.kind === "deny") {
    return denial(
      "policy-surface-write",
      `${surface.detail} Set a gate command with \`tlc harness gate test-command\` or \`gate lint-command\`, and run policy changes from your own terminal rather than from inside this session.`,
      surface.note,
    );
  }

  return checkShellSecrets(segments, input.projectDir);
}

function checkShellSecrets(segments: ShellSegment[], projectDir: string): Decision {
  for (const segment of segments) {
    const head = verbOf(segment.words);
    if (!head || !READER_VERBS.has(head.verb)) {
      continue;
    }
    for (const word of pathArgs(head.args)) {
      if (word.unresolved) {
        continue;
      }
      const resolved = resolveTarget(projectDir, word.text);
      if (isSecretPath(resolved)) {
        return denial(
          "secret-access",
          `\`${head.verb}\` would read ${resolved} into the transcript. Credentials do not belong in an agent's context.`,
          `read of ${resolved}`,
        );
      }
    }
  }
  return { kind: "allow" };
}

function checkFile(input: FloorInput): Decision {
  const filePath = input.filePath;
  if (!filePath) {
    return { kind: "allow" };
  }
  const reads =
    input.isReadEvent === true || (input.toolName !== undefined && READING_TOOLS.has(input.toolName));
  if (!reads) {
    return { kind: "allow" };
  }
  const resolved = resolveTarget(input.projectDir, filePath);
  if (!isSecretPath(resolved)) {
    return { kind: "allow" };
  }
  return denial(
    "secret-access",
    `${resolved} holds credentials, and reading it would copy them into the transcript.`,
    `read of ${resolved}`,
  );
}

// invariant: this function takes no policy. Adding a config parameter here would turn the floor into
// a guardrail, which is the one thing it must not be.
export function evaluateFloor(input: FloorInput): Decision {
  const file = checkFile(input);
  if (file.kind !== "allow") {
    return file;
  }
  return checkShell(input);
}
