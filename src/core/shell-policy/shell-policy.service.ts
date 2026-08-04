import type { Decision } from "../../contracts/decision.ts";
import { type ShellWord, tokenizeShell } from "../floor/floor.tokenize.ts";
import type { OperatorMode } from "../policy/policy.types.ts";
import { trackShellCommand } from "./shell-policy.stall.ts";
import type { ShellEffectClass } from "./shell-policy.types.ts";

const WRAPPERS = new Set(["command", "doas", "env", "nice", "nohup", "sudo", "time", "xargs"]);
const MACHINE = new Set(["halt", "poweroff", "reboot", "shutdown"]);
const NETWORK = new Set(["curl", "ftp", "gh", "nc", "ncat", "rsync", "scp", "sftp", "ssh", "telnet", "wget"]);
// invariant: a verb belongs in WRITE when it can remove or overwrite a path that already exists. `cp` and `mv`
// qualify because the destination may exist and the harness cannot know whether it does — conservative wherever
// the filesystem is unknowable. `tee` qualifies with or without `-a`, because the flagless form truncates and a
// rule whose failure mode is silent data loss does not get a special case.
const WRITE = new Set(["cp", "mv", "rm", "rmdir", "tee", "truncate"]);
// hazard: these lived in the preserving tier for one revision, on the reasoning that they lose no bytes. True and
// beside the point: they decide who can read or execute a path, `-R` applies that to a whole tree, and the result
// appears in no diff. Losing content and widening access are separate questions.
const PRIVILEGE = new Set(["chmod", "chown"]);
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
    if (PRIVILEGE.has(verb)) {
      return "privilege";
    }
    // hazard: these two used to collapse into one branch, so an append was indistinguishable from an overwrite.
    // `>` truncates the target and `>>` does not, which is exactly the line this class exists to draw.
    if (argText.includes(">")) {
      return "write";
    }
    return argText.includes(">>") ? "write-preserving" : "read";
  }
  return "read";
}

const ORDER: ShellEffectClass[] = [
  "read",
  "write-preserving",
  "write",
  "privilege",
  "network",
  "destructive",
];

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

/**
 * why: `paired` promises a check-in before a sizable non-destructive move, and `classifyShell` answers what
 * "sizable" means — a command that can lose something (`write`) or that leaves the machine (`network`).
 *
 * hazard: this used to include the whole `write` class, which asked about appending to a file. Repeated approval
 * of routine actions becomes a keystroke rather than a decision, and a habituated reviewer is the delivery
 * mechanism for the one action that mattered — approval fatigue is a security defect, not an ergonomics
 * complaint. Only `write-preserving` left the tier ([/decisions/ad-026.md](/decisions/ad-026.md)).
 *
 * hazard: `chmod` and `chown` left it too for one revision, and should not have. They lose no bytes, which was
 * the criterion, and they still decide who can reach a path — the one change that shows up in no diff. `privilege`
 * is a member here for that reason.
 *
 * invariant: this is a separate rule from `catastrophicAsk`, not an override of it. That switch keeps deciding
 * `destructive` at every posture; posture decides the tier below it. A posture that switched a capability off
 * would be the defect the posture feature exists to remove.
 *
 * hazard: the threshold is deliberately not applied to tool edits. An `Edit` of one line is a write too, and
 * asking before every one turns a posture into a permission prompt.
 */
const PAIRED_ASK: ReadonlySet<ShellEffectClass> = new Set(["write", "privilege", "network"]);

// why: named here rather than at the call sites so the recorded rate and the rule that produced it cannot drift
// apart. An operator reading "seven asks" needs to know which switch to reach for.
export const SHELL_RULES = {
  catastrophic: "shell-catastrophic",
  posture: "shell-posture-paired",
  stall: "shell-stall",
} as const;

// why: three tiers ask, and each asks a different question. One sentence covering all of them would leave the
// operator weighing the wrong risk, which fails in the same direction as not asking at all.
const AT_STAKE: Record<string, string> = {
  network: "reaches the network, so it leaves this machine and cannot be pulled back",
  privilege: "changes who can reach a path, and that will not appear in any diff",
  write: "can overwrite or remove a path that already exists",
};

function atStake(effect: ShellEffectClass): string {
  return AT_STAKE[effect] ?? "changes something outside this turn";
}

function pairedPreCheck(command: string, mode: OperatorMode): Decision | null {
  if (mode !== "paired") {
    return null;
  }
  const effect = classifyShell(command);
  if (!PAIRED_ASK.has(effect)) {
    return null;
  }
  // hazard: the reason used to end "leave the posture with `tlc harness mode solo`" — an instruction aimed at the
  // agent, which the floor refuses from inside a session. `reason` is the agent's half and `userNote` is the
  // operator's; the way out of a posture belongs in the operator's ([/decisions/ad-030.md](/decisions/ad-030.md)).
  return {
    kind: "ask",
    reason: `Posture paired: this command ${atStake(effect)}, and the operator asked to see these before they run. Wait for their answer — the posture is theirs to change, not yours.`,
    userNote: `Paired posture: this ${effect} command ${atStake(effect)}. Approve it, or leave the posture with \`tlc harness mode solo\`.`,
    rule: SHELL_RULES.posture,
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
      rule: SHELL_RULES.catastrophic,
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
        rule: SHELL_RULES.stall,
      };
    }
  }

  return { kind: "allow" };
}
