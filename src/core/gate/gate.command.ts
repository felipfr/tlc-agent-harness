import { basename } from "node:path";
import type { AppendFilesMode } from "./gate.types.ts";

const RECIPE_RUNNERS = new Set(["just", "make", "task", "mise", "rake"]);

const RESOLUTION_FAILURE_PATTERNS = [
  /does not contain recipe/i,
  /no rule to make target/i,
  /unknown recipe/i,
  /missing script:/i,
  /task ".*" does not exist/i,
  /don't know how to build task/i,
];

function executableName(command: string[]): string {
  const argv0 = command[0] ?? "";
  return basename(argv0)
    .replace(/\.(exe|cmd|bat)$/i, "")
    .toLowerCase();
}

/**
 * A recipe runner takes a target name, not a file list. Appending changed files makes it read the first path
 * as a second target and abort, so the gate reports a failure that the code cannot cause and the agent cannot
 * fix. Anything else receives the file list, which keeps per-file runs fast where the runner supports them.
 */
export function isRecipeRunner(command: string[]): boolean {
  return RECIPE_RUNNERS.has(executableName(command));
}

export function shouldAppendFiles(command: string[], mode: AppendFilesMode): boolean {
  if (command.length === 0) {
    return false;
  }
  if (mode === "always") {
    return true;
  }
  if (mode === "never") {
    return false;
  }
  return !isRecipeRunner(command);
}

/**
 * The command never ran: a missing binary (127) or a runner that could not resolve the target. This is a
 * configuration fault, not a failing assertion, and classifying it as verification sends the agent to edit
 * healthy tests.
 */
export function isCommandResolutionFailure(args: { exitCode: number; output: string }): boolean {
  if (args.exitCode === 127) {
    return true;
  }
  return RESOLUTION_FAILURE_PATTERNS.some((pattern) => pattern.test(args.output));
}
