import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { coreFacade } from "../src/core/index.ts";
import { flagsDir, projectStateDir, runtimeHome } from "../src/platform/paths.ts";

export class UsageError extends Error {}

const MODE_ALIASES: Record<string, string> = {
  solo: "solo",
  paired: "paired",
  focus: "heads-down",
  "heads-down": "heads-down",
  heads: "heads-down",
};

export function resolveProjectRoot(): string {
  return process.env.TLC_PROJECT_DIR ?? process.cwd();
}

export function modeFilePath(root: string): string {
  return join(projectStateDir(root), "harness-mode");
}

export function grindFlagPath(root: string): string {
  return join(flagsDir(root), "grind-on");
}

export function skipFlagPath(root: string): string {
  return join(flagsDir(root), "skip-verify");
}

export function headsDownFlagPath(root: string): string {
  return join(flagsDir(root), "heads-down");
}

export function pairedFlagPath(root: string): string {
  return join(flagsDir(root), "paired");
}

export function ensureFlagsDir(root: string): void {
  mkdirSync(flagsDir(root), { recursive: true });
}

export function readMode(root: string): string {
  const modeFile = modeFilePath(root);
  if (existsSync(modeFile)) {
    const raw = readFileSync(modeFile, "utf8").trim().toLowerCase();
    if (raw === "heads-down") {
      return "focus";
    }
    if (raw === "solo" || raw === "paired") {
      return raw;
    }
  }
  if (existsSync(headsDownFlagPath(root))) {
    return "focus";
  }
  if (existsSync(pairedFlagPath(root))) {
    return "paired";
  }
  return "solo";
}

export function grindOn(root: string): boolean {
  return existsSync(grindFlagPath(root)) || readMode(root) === "focus";
}

export function gatesPaused(root: string): boolean {
  return existsSync(skipFlagPath(root));
}

export function statusText(root: string): string {
  const mode = readMode(root);
  return [
    `harness @ ${root}`,
    `  mode:   ${mode}${mode === "focus" ? " (max autonomy + grind)" : ""}`,
    `  grind:  ${grindOn(root) ? "ON  — stop hook re-runs lint/tests and auto-retries on fail" : "OFF — no auto fix loops"}`,
    `  gates:  ${gatesPaused(root) ? "PAUSED — stop checks disabled" : "active"}`,
    "",
    "Quick help:",
    "  grind ON  = after each agent turn, lint/test changed files; if fail → agent must fix",
    "  pause     = temporarily disable those stop checks",
    "  focus     = solo on steroids: fewer questions + grind ON",
    "  solo      = normal daily mode (grind not forced)",
    "  paired    = explain more; check in before big moves",
  ].join("\n");
}

export function setGrind(root: string, on: boolean): string {
  ensureFlagsDir(root);
  const path = grindFlagPath(root);
  if (on) {
    writeFileSync(path, "");
    return "grind ON — stop hook will lint/test and auto-retry on failure";
  }
  if (existsSync(path)) {
    rmSync(path);
  }
  return "grind OFF — no auto fix loops";
}

export function setPaused(root: string, on: boolean): string {
  ensureFlagsDir(root);
  const path = skipFlagPath(root);
  if (on) {
    writeFileSync(path, "");
    return "gates PAUSED — stop checks disabled until `tlc harness resume`";
  }
  if (existsSync(path)) {
    rmSync(path);
  }
  return "gates ACTIVE again";
}

export function setMode(root: string, raw: string): string {
  const mapped = MODE_ALIASES[raw.toLowerCase()];
  if (!mapped) {
    throw new UsageError("mode must be: solo | paired | focus");
  }
  ensureFlagsDir(root);
  writeFileSync(modeFilePath(root), `${mapped}\n`);
  if (mapped === "heads-down") {
    return "mode focus — max autonomy + grind ON";
  }
  if (mapped === "paired") {
    return "mode paired — explain more; check in before big moves";
  }
  return "mode solo — normal day-to-day (grind not forced by mode)";
}

export function helpText(): string {
  return `tlc harness — agent steering (gates / follow-up / handoff / policy)

Requires Node.js 24+ (Active LTS 24 or Current 26).

QUICK
  tlc harness status              mode / grind / gates
  tlc harness update              pull runtime + refresh skill/CLI, then doctor
  tlc harness doctor               health checklist
  tlc harness build                compile dist/ for Node
  tlc harness test                 run the full local gate
  tlc harness help <topic>         documentation

TOPICS
  architecture | concepts | lessons | measure | prices | diagnose | init

CONTROL
  tlc harness grind [on|off]   tlc harness pause | resume   tlc harness mode solo|paired|focus

MEASURE
  tlc harness obs live|events|report|prune
  tlc harness prices refresh [all|cursor|litellm]
  tlc harness prices lookup <model-id>
  tlc harness lessons list|show|garden|sync-rules

PROJECT
  tlc harness init --minimal | tlc harness init --write --stdin-json
`;
}

export function pricesHelpText(): string {
  return `tlc harness prices

  tlc harness prices refresh [all|cursor|litellm]
  tlc harness prices lookup <model-id>

  refresh / refresh all   Cursor catalog + LiteLLM fallback
  refresh cursor          model-prices.cursor.json (tracked)
  refresh litellm         model-prices.litellm.json (local)
  lookup <model-id>       catalog key, pool, USD for 1M in + 1M out

  Resolution: overrides → Cursor → LiteLLM → null
  Documentation: tlc harness help prices
`;
}

export function resolveHarnessRoot(): string {
  const home = runtimeHome();
  try {
    return realpathSync(home);
  } catch {
    return home;
  }
}

export function execBinPath(): string {
  return join(resolveHarnessRoot(), "bin", "tlc-exec");
}

export function buildBinPath(): string {
  return join(resolveHarnessRoot(), "bin", "tlc-build");
}

export type Action =
  | { kind: "status" }
  | { kind: "help" }
  | { kind: "build" }
  | { kind: "update" }
  | { kind: "test" }
  | { kind: "grind"; on: boolean }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "mode"; value: string }
  | { kind: "prices-help" }
  | { kind: "prices-refresh"; scope: string }
  | { kind: "prices-lookup"; modelId: string }
  | { kind: "entry"; entry: string; args: string[] }
  | { kind: "unknown"; cmd: string };

export function route(args: string[]): Action {
  const cmd = (args[0] ?? "status").toLowerCase();
  switch (cmd) {
    case "status":
    case "st":
    case "s":
      return { kind: "status" };
    case "build":
    case "rebuild":
      return { kind: "build" };
    case "update":
    case "upgrade":
      return { kind: "update" };
    case "test":
      return { kind: "test" };
    case "grind":
    case "g": {
      const arg = (args[1] ?? "on").toLowerCase();
      if (arg === "on" || arg === "1" || arg === "true") {
        return { kind: "grind", on: true };
      }
      if (arg === "off" || arg === "0" || arg === "false") {
        return { kind: "grind", on: false };
      }
      throw new UsageError("usage: tlc harness grind [on|off]");
    }
    case "pause":
    case "p":
      return { kind: "pause" };
    case "resume":
    case "r":
      return { kind: "resume" };
    case "mode":
    case "m": {
      const modeArg = args[1];
      if (!modeArg) {
        throw new UsageError("usage: tlc harness mode <solo|paired|focus>");
      }
      return { kind: "mode", value: modeArg };
    }
    case "prices": {
      const sub = (args[1] ?? "").toLowerCase();
      if (!sub || sub === "help" || sub === "-h" || sub === "--help") {
        return { kind: "prices-help" };
      }
      if (sub === "refresh") {
        return { kind: "prices-refresh", scope: args[2] ?? "all" };
      }
      if (sub === "lookup" || sub === "get") {
        const modelId = args[2];
        if (!modelId) {
          throw new UsageError(
            "usage: tlc harness prices lookup <model-id>\ndetail: tlc harness help prices",
          );
        }
        return { kind: "prices-lookup", modelId };
      }
      throw new UsageError(
        "usage: tlc harness prices refresh [all|cursor|litellm] | tlc harness prices lookup <model>\ndetail: tlc harness help prices",
      );
    }
    case "obs":
    case "o":
      return { kind: "entry", entry: "obs-cli", args: args.slice(1) };
    case "doctor":
    case "doc":
      return { kind: "entry", entry: "doctor", args: [] };
    case "lessons":
    case "lesson":
      return { kind: "entry", entry: "lessons-cli", args: args.slice(1) };
    case "init":
      return { kind: "entry", entry: "init-project", args: args.slice(1) };
    case "help":
    case "-h":
    case "--help": {
      const topic = args[1];
      if (!topic) {
        return { kind: "help" };
      }
      return { kind: "entry", entry: "help-topic", args: [topic] };
    }
    default:
      return { kind: "unknown", cmd };
  }
}

export type TestStep = { label: string; bin: string; args: string[] };

export function buildTestSteps(): TestStep[] {
  return [
    { label: "biome check", bin: "npx", args: ["biome", "check"] },
    { label: "tsc --noEmit", bin: "npx", args: ["tsc", "--noEmit"] },
    { label: "src suite", bin: "node", args: ["--test", "src/**/__test__/*.test.ts"] },
    { label: "tools suite", bin: "node", args: ["--test", "tools/__test__/*.test.ts"] },
    { label: "check-boundaries", bin: "node", args: ["tools/check-boundaries.ts"] },
    { label: "check-docs-bundle", bin: "node", args: ["tools/check-docs-bundle.ts"] },
    { label: "capabilities in sync", bin: "node", args: ["tools/render-capabilities.ts", "--check"] },
  ];
}

export type StepSpawner = (bin: string, args: string[], cwd: string) => { status: number | null };

export function runTestSteps(
  steps: TestStep[],
  cwd: string,
  spawner: StepSpawner = (bin, spawnArgs, spawnCwd) =>
    spawnSync(bin, spawnArgs, { cwd: spawnCwd, stdio: "inherit" }),
): number {
  for (const step of steps) {
    console.log(`tlc harness test: running ${step.label}`);
    const result = spawner(step.bin, step.args, cwd);
    const status = result.status ?? 1;
    if (status !== 0) {
      console.error(`tlc harness test: FAILED at "${step.label}" (exit ${status})`);
      return status;
    }
  }
  console.log("tlc harness test: all steps passed");
  return 0;
}

function announceNewCapabilities(root: string, runtimeRoot: string): void {
  const catalog = coreFacade.capability.loadCatalog(runtimeRoot);
  const policy = coreFacade.capability.readProjectPolicyRaw(root);
  if (!catalog || !policy) {
    return;
  }
  const seen = coreFacade.capability.readRuntimeSeen(root);
  const fresh = coreFacade.capability.listNewlyAnnounceable(policy, catalog, seen.catalogVersion);
  if (fresh.length === 0) {
    return;
  }
  console.log("");
  console.log(coreFacade.capability.formatCapabilityDigest(fresh));
  console.log("");
  void coreFacade.capability.writeRuntimeSeen(root, catalog.catalogVersion);
}

function runUpdate(root: string): never {
  const dest = resolveHarnessRoot();
  const home = runtimeHome();
  console.log(`update: runtime → ${dest}`);

  if (!existsSync(join(dest, "bin", "tlc-exec.mjs"))) {
    console.error(`update: missing install at ${home}`);
    console.error("update: install once with the curl/irm installer from the README, then retry.");
    process.exit(1);
  }

  if (existsSync(join(dest, ".git"))) {
    const fetch = spawnSync("git", ["-C", dest, "fetch", "origin"], {
      stdio: "inherit",
      env: process.env,
    });
    if ((fetch.status ?? 1) !== 0) {
      console.error("update: git fetch failed.");
      process.exit(fetch.status ?? 1);
    }
    const branchProc = spawnSync("git", ["-C", dest, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      env: process.env,
    });
    const branch = (branchProc.stdout ?? "").trim() || "main";
    const upstreamProc = spawnSync("git", ["-C", dest, "rev-parse", "--abbrev-ref", "@{u}"], {
      encoding: "utf8",
      env: process.env,
    });
    const mergeRef =
      (upstreamProc.status ?? 1) === 0 && (upstreamProc.stdout ?? "").trim()
        ? (upstreamProc.stdout ?? "").trim()
        : `origin/${branch}`;
    const merge = spawnSync("git", ["-C", dest, "merge", "--ff-only", mergeRef], {
      stdio: "inherit",
      env: process.env,
    });
    if ((merge.status ?? 1) !== 0) {
      console.error(`update: fast-forward failed (${mergeRef}). Fix the checkout or re-install.`);
      process.exit(merge.status ?? 1);
    }
  } else {
    console.log("update: no .git at runtime path — skipped pull (linked checkout?).");
  }

  const binDir = process.env.TLC_BIN_DIR || join(homedir(), ".local", "bin");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(join(home, "..", "skills"), { recursive: true });

  if (process.platform === "win32") {
    const installPs1 = join(dest, "install.ps1");
    const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", installPs1], {
      stdio: "inherit",
      env: { ...process.env, TLC_HOME: home },
      cwd: dest,
    });
    if ((r.status ?? 1) !== 0) {
      process.exit(r.status ?? 1);
    }
  } else {
    const tlcBin = join(dest, "bin", "tlc");
    const skillSrc = join(dest, "skills", "harness-init");
    const skillDest = join(home, "..", "skills", "harness-init");
    spawnSync("ln", ["-sfn", tlcBin, join(binDir, "tlc")], { stdio: "inherit" });
    if (!existsSync(skillSrc)) {
      console.error(`update: missing skill at ${skillSrc}`);
      process.exit(1);
    }
    spawnSync("ln", ["-sfn", skillSrc, skillDest], { stdio: "inherit" });
    console.log(`update: skill → ${skillDest}`);
    const hooks = spawnSync(process.execPath, [join(dest, "bin", "write-user-hooks.mjs")], {
      stdio: "inherit",
      env: { ...process.env, TLC_HOME: home },
    });
    if ((hooks.status ?? 1) !== 0) {
      console.log("update: hooks unchanged (merge manually or: node bin/write-user-hooks.mjs --force)");
    }
  }

  if (existsSync(buildBinPath())) {
    const build = spawnSync(buildBinPath(), [], { stdio: "inherit", env: process.env });
    if ((build.status ?? 1) !== 0) {
      console.log("update: build skipped/failed — ok if dist/ already matches the pulled revision");
    }
  }

  announceNewCapabilities(root, dest);

  console.log("update: running doctor…");
  const doctor = spawnSync(execBinPath(), ["doctor"], {
    stdio: "inherit",
    env: { ...process.env, TLC_PROJECT_DIR: root },
  });
  console.log("update: ok — reload if hooks/skill should refresh");
  process.exit(doctor.status ?? 0);
}

function runEntry(entry: string, toolArgs: string[], root: string): never {
  const r = spawnSync(execBinPath(), [entry, ...toolArgs], {
    stdio: "inherit",
    env: { ...process.env, TLC_PROJECT_DIR: root },
  });
  process.exit(r.status ?? 1);
}

function main(argv: string[]): void {
  const root = resolveProjectRoot();
  const group = (argv[0] ?? "").toLowerCase();
  if (group !== "harness") {
    console.error(`unknown: ${argv[0] ?? ""}`);
    console.error(
      "usage: tlc harness <status|doctor|help|grind|pause|resume|mode|obs|prices|lessons|init|update|test|build>",
    );
    process.exit(1);
  }

  const args = argv.slice(1);
  let action: Action;
  try {
    action = route(args);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }

  switch (action.kind) {
    case "status":
      console.log(statusText(root));
      break;
    case "help":
      console.log(helpText());
      break;
    case "build": {
      const r = spawnSync(buildBinPath(), [], { stdio: "inherit", env: process.env });
      process.exit(r.status ?? 1);
      break;
    }
    case "update":
      runUpdate(root);
      break;
    case "test": {
      const status = runTestSteps(buildTestSteps(), process.cwd());
      process.exit(status);
      break;
    }
    case "grind":
      console.log(setGrind(root, action.on));
      break;
    case "pause":
      console.log(setPaused(root, true));
      break;
    case "resume":
      console.log(setPaused(root, false));
      break;
    case "mode":
      try {
        console.log(setMode(root, action.value));
      } catch (error) {
        if (error instanceof UsageError) {
          console.error(error.message);
          process.exit(1);
        }
        throw error;
      }
      break;
    case "prices-help":
      console.log(pricesHelpText());
      break;
    case "prices-refresh":
      runEntry("refresh-model-prices", [action.scope], root);
      break;
    case "prices-lookup":
      runEntry("price-lookup", [action.modelId], root);
      break;
    case "entry":
      runEntry(action.entry, action.args, root);
      break;
    case "unknown":
      console.error(`unknown: ${action.cmd}`);
      console.log(helpText());
      process.exit(1);
  }
}

if (import.meta.main) {
  main(process.argv.slice(2));
}
