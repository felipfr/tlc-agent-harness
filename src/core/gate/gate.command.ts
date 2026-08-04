import { basename } from "node:path";
import type { AppendFilesMode } from "./gate.types.ts";

const RECIPE_RUNNERS = new Set(["just", "make", "task", "mise", "rake"]);

/**
 * hazard: `npm` was absent from the no-append set while `missing script:` sat in the resolution-failure patterns —
 * so the codebase already knew npm invokes a script and still appended file paths to it. Measured on a real install:
 * `npm test` with `appendFiles: "auto"` had changed files appended, and whether they reach the runner depends on the
 * package manager and its version. The harness cannot know, so it must not guess
 * ([/decisions/ad-033.md](/decisions/ad-033.md)).
 *
 * why: the reason is the recipe-runner reason. The argument is forwarded to somebody else's script, and what that
 * script does with a path is not something this process can reason about. `never` and `always` stay available for an
 * operator who knows their own command.
 */
const SCRIPT_RUNNERS = new Set(["npm", "yarn", "pnpm"]);

/**
 * why: `npx`, `bunx` and `pnpm dlx` are transparent — they run the tool named next, and that tool is what decides
 * whether a file path narrows the run. Treating them as script runners would refuse to narrow `npx jest <file>`,
 * which is the shape narrowing exists for.
 */
const TRANSPARENT_PREFIXES = new Set(["npx", "bunx", "dlx", "exec"]);

const GLOB_CHARS = /[*?[\]]/;

export type AppendVerdict = { appends: boolean; reason?: string };

const RESOLUTION_FAILURE_PATTERNS = [
  /does not contain recipe/i,
  /no rule to make target/i,
  /unknown recipe/i,
  /missing script:/i,
  /task ".*" does not exist/i,
  /don't know how to build task/i,
];

/** why: resolves through a transparent prefix to the tool that actually receives the arguments. */
function effectiveCommand(command: string[]): string[] {
  let rest = command;
  while (rest.length > 1 && TRANSPARENT_PREFIXES.has(bareName(rest[0] as string))) {
    rest = rest.slice(1);
  }
  // why: `bun run <script>` and `pnpm dlx <tool>` put the meaningful token one further along.
  if (rest.length > 2 && bareName(rest[0] as string) === "bun" && rest[1] === "run") {
    return ["npm", ...rest.slice(1)];
  }
  return rest;
}

function bareName(argv0: string): string {
  return basename(argv0)
    .replace(/\.(exe|cmd|bat)$/i, "")
    .toLowerCase();
}

/** why: the name of the tool that actually receives the arguments, after resolving any transparent prefix. */
function executableName(command: string[]): string {
  return bareName(effectiveCommand(command)[0] ?? "");
}

/**
 * A recipe runner takes a target name, not a file list. Appending changed files makes it read the first path
 * as a second target and abort, so the gate reports a failure that the code cannot cause and the agent cannot
 * fix. Anything else receives the file list, which keeps per-file runs fast where the runner supports them.
 */
export function isRecipeRunner(command: string[]): boolean {
  return RECIPE_RUNNERS.has(executableName(command));
}

export function isScriptRunner(command: string[]): boolean {
  return SCRIPT_RUNNERS.has(executableName(command));
}

/**
 * hazard: a command that already carries its own glob cannot be narrowed by appending paths — it walks the glob
 * regardless. Measured on a real install: an eslint command globbing `src/**` and `test/**` linted the whole tree on
 * every stop, three times per turn, while `auto` reported itself as narrowing to changed files.
 *
 * why: the verdict carries a reason so `doctor` can say why narrowing is not happening. A capability that silently
 * does nothing is the defect this project keeps finding; one that says why is a configuration choice.
 */
export function appendFilesVerdict(command: string[], mode: AppendFilesMode): AppendVerdict {
  if (command.length === 0) {
    return { appends: false, reason: "the command is empty" };
  }
  if (mode === "always") {
    return { appends: true };
  }
  if (mode === "never") {
    return { appends: false, reason: "appendFiles is set to never" };
  }
  if (isRecipeRunner(command)) {
    return {
      appends: false,
      reason: `\`${executableName(command)}\` takes a target name, so a file path would read as a second target`,
    };
  }
  if (isScriptRunner(command)) {
    return {
      appends: false,
      reason: `\`${executableName(command)}\` invokes a script, and whether a path reaches the runner is not something the harness can know`,
    };
  }
  const glob = command.find((arg) => GLOB_CHARS.test(arg));
  if (glob !== undefined) {
    return {
      appends: false,
      reason: `the command already scopes itself with \`${glob}\`, so appending files would not narrow the run`,
    };
  }
  return { appends: true };
}

export function shouldAppendFiles(command: string[], mode: AppendFilesMode): boolean {
  return appendFilesVerdict(command, mode).appends;
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
