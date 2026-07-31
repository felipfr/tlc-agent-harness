import type { ShellWord } from "./floor.tokenize.ts";

export const WRAPPERS = new Set(["command", "doas", "env", "nice", "nohup", "sudo", "time", "xargs"]);

export type SegmentHead = { verb: string; args: ShellWord[] };

// why: `env FOO=bar cmd` and `sudo -n cmd` both delay the real verb; flags and assignments are skipped.
export function verbOf(words: ShellWord[]): SegmentHead | null {
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (!word) {
      return null;
    }
    if (WRAPPERS.has(word.text) || word.text.startsWith("-") || word.text.includes("=")) {
      index += 1;
      continue;
    }
    return { verb: word.text.split("/").pop() ?? word.text, args: words.slice(index + 1) };
  }
  return null;
}

// why: two floor rules need the head verb, and a second copy of the wrapper list would drift from this one
// the first time a wrapper is added.
export function firstOperand(args: ShellWord[]): ShellWord | null {
  return args.find((word) => !word.text.startsWith("-") && word.text !== "") ?? null;
}
