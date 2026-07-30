import type { Decision } from "../../contracts/decision.ts";
import { type ShellWord, tokenizeShell } from "../floor/floor.tokenize.ts";
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
  catastrophicAsk: boolean;
  stallDetection: boolean;
  stallRepeatThreshold: number;
};

export function evaluateShellCommand(args: EvaluateShellCommandArgs): Decision {
  const command = args.command;
  if (!command) {
    return { kind: "allow" };
  }

  if (args.catastrophicAsk && isCatastrophic(command)) {
    return {
      kind: "ask",
      reason:
        "The command was flagged as potentially catastrophic. Prefer scoped paths inside the repo or reversible operations.",
      userNote: "This shell command can destroy data outside the workspace. Approve only if you intend it.",
    };
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
