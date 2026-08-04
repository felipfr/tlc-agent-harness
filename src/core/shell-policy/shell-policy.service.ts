import type { Decision } from "../../contracts/decision.ts";
import { type ShellWord, tokenizeShell } from "../floor/floor.tokenize.ts";
import type { OperatorMode } from "../policy/policy.types.ts";
import { trackShellCommand } from "./shell-policy.stall.ts";
import type { ShellEffectClass } from "./shell-policy.types.ts";

const WRAPPERS = new Set(["command", "doas", "env", "nice", "nohup", "sudo", "time", "xargs"]);
const MACHINE = new Set(["halt", "poweroff", "reboot", "shutdown"]);
const NETWORK = new Set(["curl", "ftp", "gh", "nc", "ncat", "rsync", "scp", "sftp", "ssh", "telnet", "wget"]);
const WRITE = new Set(["chmod", "chown", "cp", "mv", "rm", "rmdir", "tee", "truncate"]);
const DEVICE = /^\/dev\/(sd|nvme|vd|hd|disk)/;

// invariant: classification reads head verbs from the shared tokenizer, never patterns in the raw
// string, so quoted text and heredoc bodies stay data rather than commands.
function classifySegment(words: ShellWord[]): ShellEffectClass {
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (!word) {
      break;
    }
    if (WRAPPERS.has(word.text) || word.text.startsWith("-") || word.text.includes("=")) {
      index += 1;
      continue;
    }
    const verb = word.text.split("/").pop() ?? word.text;
    const args = words.slice(index + 1);
    const argText = args.map((arg) => arg.text);

    if (MACHINE.has(verb) || verb === "mkfs" || verb.startsWith("mkfs.")) {
      return "destructive";
    }
    if (verb === "dd" && argText.some((arg) => arg.startsWith("of=") && DEVICE.test(arg.slice(3)))) {
      return "destructive";
    }
    if (
      verb === "diskutil" &&
      argText.some((arg) => arg.startsWith("erase") || arg.startsWith("partition"))
    ) {
      return "destructive";
    }
    if (verb === "rm" && argText.some((arg) => arg === "/" || arg === "/*" || arg.startsWith("../../"))) {
      return "destructive";
    }
    if (NETWORK.has(verb)) {
      return "network";
    }
    if ((verb === "git" || verb === "docker") && argText.includes("push")) {
      return "network";
    }
    if (WRITE.has(verb) || (verb === "sed" && argText.includes("-i"))) {
      return "write";
    }
    return argText.some((arg) => arg === ">" || arg === ">>") ? "write" : "read";
  }
  return "read";
}

const ORDER: ShellEffectClass[] = ["read", "write", "network", "destructive"];

export function classifyShell(command: string): ShellEffectClass {
  let worst: ShellEffectClass = "read";
  for (const segment of tokenizeShell(command)) {
    const found = classifySegment(segment.words);
    if (ORDER.indexOf(found) > ORDER.indexOf(worst)) {
      worst = found;
    }
  }
  return worst;
}

export function isCatastrophic(command: string): boolean {
  return classifyShell(command) === "destructive";
}

function stallFollowup(command: string, hits: number): string {
  return [
    `BLOCKED: shell stall — the same command was attempted ${hits} times.`,
    `TRIED: \`${command.slice(0, 160)}\``,
    "NEED: change approach. Do not repeat this command. Diagnose why it failed, use a different tool/path, or escalate with BLOCKED/TRIED/NEED.",
  ].join("\n");
}

export type EvaluateShellCommandArgs = {
  command: string;
  sessionKey: string;
  projectDir: string;
  /** The active operator posture. Only `paired` lowers the interruption threshold. */
  mode: OperatorMode;
  catastrophicAsk: boolean;
  stallDetection: boolean;
  stallRepeatThreshold: number;
};

// why: `paired` promises a check-in before a sizable non-destructive move, and until now promised it in text
// only. `classifyShell` already answers what "sizable" means for a shell command: `write` and `network` change
// something beyond the immediate code — git push, curl, rm, cp, mv, chmod, tee — while `read` does not.
//
// invariant: this is a separate rule from `catastrophicAsk`, not an override of it. That switch keeps deciding
// `destructive` at every posture; posture decides the tier below it. A posture that switched a capability off
// would be the defect this feature exists to remove.
//
// hazard: the threshold is deliberately not applied to tool edits. An `Edit` of one line is a write too, and
// asking before every one turns a posture into a permission prompt.
const PAIRED_ASK: ReadonlySet<ShellEffectClass> = new Set(["write", "network"]);

function pairedPreCheck(command: string, mode: OperatorMode): Decision | null {
  if (mode !== "paired") {
    return null;
  }
  const effect = classifyShell(command);
  if (!PAIRED_ASK.has(effect)) {
    return null;
  }
  return {
    kind: "ask",
    reason: `Posture paired: this command ${effect === "network" ? "reaches the network" : "changes files"}, so it is a sizable non-destructive move and you asked to be shown these before they run. Approve it, or leave the posture with \`tlc harness mode solo\`.`,
    userNote: `Paired posture: approve this ${effect} command or switch posture.`,
  };
}

export function evaluateShellCommand(args: EvaluateShellCommandArgs): Decision {
  const command = args.command;
  if (!command) {
    return { kind: "allow" };
  }

  // why: destructive is decided first and identically at every posture — it is the one stop that never
  // narrows. The paired rule governs what sits below it.
  if (args.catastrophicAsk && isCatastrophic(command)) {
    return {
      kind: "ask",
      reason:
        "The command was flagged as potentially catastrophic. Prefer scoped paths inside the repo or reversible operations.",
      userNote: "This shell command can destroy data outside the workspace. Approve only if you intend it.",
    };
  }

  const preCheck = pairedPreCheck(command, args.mode);
  if (preCheck) {
    return preCheck;
  }

  if (args.stallDetection) {
    const hits = trackShellCommand(args.projectDir, args.sessionKey, command);
    if (hits >= args.stallRepeatThreshold) {
      return {
        kind: "deny",
        reason: stallFollowup(command, hits),
        userNote: `Harness blocked a repeated shell command (${hits}x).`,
      };
    }
  }

  return { kind: "allow" };
}
