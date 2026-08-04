import { existsSync, lstatSync, readFileSync, readlinkSync } from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { dirname, join } from "node:path";
import { findBunOnPath, writeRuntimeCache } from "../bin/tlc-exec.mjs";
import { isCursorWired } from "../bin/write-user-hooks.mjs";
import type { ProviderWiring } from "../src/contracts/index.ts";
import { coreFacade } from "../src/core/index.ts";
import { emitJson, takeJsonFlag } from "../src/platform/cli-output.ts";
import { projectConfigPath, projectStateDir, runtimeHome } from "../src/platform/paths.ts";
import { mergeClaudeSettings } from "../src/providers/claude/claude.wiring.ts";
import { providers } from "../src/providers/index.ts";
import type { ProviderPort } from "../src/providers/provider.port.ts";

export type CheckLevel = "ok" | "warn" | "fail";

export type Check = { level: CheckLevel; name: string; detail: string };

const MIN_NODE = 24;
const BUN_COST_NOTE = "hook cost ~1 ms with Bun vs ~27 ms with Node — install: https://bun.sh";

export function checkNodeVersion(nodeVersion: string, bunPath: string | null = null): Check[] {
  const nodeMajor = Number.parseInt(nodeVersion.replace(/^v/, "").split(".")[0] ?? "0", 10);
  const checks: Check[] = [
    {
      // why: Bun runs hooks directly, so an old Node is not a failure when Bun is present — only the
      // absence of both leaves a hook with nothing to run.
      level: nodeMajor >= MIN_NODE || bunPath !== null ? "ok" : "fail",
      name: "Node.js runtime",
      detail:
        nodeMajor >= MIN_NODE
          ? `${nodeVersion} (>= ${MIN_NODE})`
          : bunPath !== null
            ? `${nodeVersion} — below ${MIN_NODE}, covered by Bun at ${bunPath}`
            : `${nodeVersion} — no runtime for hooks. Install Bun (curl -fsSL https://bun.sh/install | bash) or Node ${MIN_NODE}+ (nodejs.org), then reload the editor.`,
    },
  ];
  if (nodeMajor === 25) {
    checks.push({
      level: "warn",
      name: "Node.js line",
      detail: "Node 25 is EOL — prefer 24 LTS or 26 Current",
    });
  }
  return checks;
}

export function checkRuntimePaths(home: string, platform: NodeJS.Platform): Check[] {
  const launcher = join(home, "bin", "tlc-exec.mjs");
  const distSample = join(home, "dist", "stop.mjs");
  const cliLink = join(homedir(), ".local", "bin", platform === "win32" ? "tlc.cmd" : "tlc");
  return [
    { level: "ok", name: "platform", detail: platform },
    { level: existsSync(launcher) ? "ok" : "fail", name: "global runtime", detail: home },
    {
      level: existsSync(distSample) ? "ok" : "fail",
      name: "dist bundles",
      // why: a fixed remediation string reads as an instruction on a passing check.
      detail: existsSync(distSample) ? join(home, "dist") : "missing — run: tlc harness build",
    },
    { level: existsSync(launcher) ? "ok" : "fail", name: "portable launcher", detail: launcher },
    {
      level:
        existsSync(cliLink) || existsSync(join(home, "bin", platform === "win32" ? "tlc.cmd" : "tlc"))
          ? "ok"
          : "fail",
      name: "CLI on PATH",
      detail: cliLink,
    },
  ];
}

export function checkHookRuntime(_home: string, bunPath: string | null): Check {
  if (bunPath) {
    return { level: "ok", name: "hook runtime", detail: `Bun (${bunPath})` };
  }
  return { level: "warn", name: "hook runtime", detail: `Node + dist/ — ${BUN_COST_NOTE}` };
}

export type ProviderWiringStatus = "wired" | "detected-but-unwired" | "not-installed";

export function providerWiringStatus(wiring: ProviderWiring): ProviderWiringStatus {
  if (!existsSync(dirname(wiring.target))) {
    return "not-installed";
  }
  if (wiring.strategy === "replace") {
    return isCursorWired(wiring.target) ? "wired" : "detected-but-unwired";
  }
  const existingText = existsSync(wiring.target) ? readFileSync(wiring.target, "utf8") : null;
  const result = mergeClaudeSettings(existingText, wiring.entries);
  return result.ok && !result.changed ? "wired" : "detected-but-unwired";
}

export function checkProviders(registry: readonly ProviderPort[], home: string): Check[] {
  const launcherPath = join(home, "bin", "tlc-exec.mjs");
  return registry.map((provider) => {
    const wiring = provider.wiring({ launcherPath });
    const status = providerWiringStatus(wiring);
    if (status === "not-installed") {
      return { level: "ok", name: `${provider.name} wiring`, detail: "not installed" };
    }
    if (status === "wired") {
      return { level: "ok", name: `${provider.name} wiring`, detail: `wired (${wiring.target})` };
    }
    return {
      level: "warn",
      name: `${provider.name} wiring`,
      detail: `detected but not wired — run: tlc harness update (${wiring.target})`,
    };
  });
}

export function checkCapabilities(root: string, runtimeRoot: string): Check[] {
  const catalog = coreFacade.capability.loadCatalog(runtimeRoot);
  const policy = coreFacade.capability.readProjectPolicyRaw(root);
  if (!catalog || !policy) {
    return [];
  }
  return coreFacade.capability.listAvailableNotEnabled(policy, catalog).map((cap) => ({
    level: "warn" as const,
    name: `capability ${cap.id}`,
    detail: coreFacade.capability.formatDoctorWarn(cap),
  }));
}

// why: a posture that could not be honoured is silently replaced by the default everywhere else — the loader
// applies it, the hooks obey it, and nothing in a running session says the operator's word was refused. This is
// the surface that names it, which is what makes the one-word fix findable.
function checkPosture(root: string): Check {
  const posture = coreFacade.policy.resolveProjectPosture(root);
  if (posture.origin !== "fallback") {
    return { level: "ok", name: "operator posture", detail: `${posture.mode} (from ${posture.origin})` };
  }
  return {
    level: "warn",
    name: "operator posture",
    detail: `\`${posture.invalid}\` is not a posture — running as ${posture.mode}. Accepted: ${coreFacade.policy.OPERATOR_MODES.join(" | ")}. Fix \`mode\` in ${projectConfigPath(root)}, or run: tlc harness mode ${posture.mode}`,
  };
}

export function checkProjectPolicy(root: string): Check[] {
  const configPath = projectConfigPath(root);
  const stateDir = projectStateDir(root);
  return [
    {
      level: "ok",
      name: "project policy",
      detail: existsSync(configPath) ? configPath : "missing — run: tlc harness init",
    },
    {
      level: "ok",
      name: "state dir",
      detail: existsSync(stateDir) ? stateDir : `${stateDir} (created on first session)`,
    },
    checkPosture(root),
  ];
}

export function checkGlobalCommands(home: string): Check {
  const globalCommands = join(home, ".cursor", "commands");
  if (!existsSync(globalCommands)) {
    return {
      level: "ok",
      name: "global commands dir",
      detail: "optional — ~/.cursor/commands for slash commands",
    };
  }
  try {
    const st = lstatSync(globalCommands);
    const detail = st.isSymbolicLink()
      ? `${globalCommands} → ${readlinkSync(globalCommands)}`
      : globalCommands;
    return { level: "ok", name: "global commands dir", detail };
  } catch {
    return { level: "ok", name: "global commands dir", detail: globalCommands };
  }
}

export type DoctorContext = {
  root: string;
  home: string;
  runtimeHome: string;
  platform: NodeJS.Platform;
  nodeVersion: string;
  bunPath: string | null;
  registry: readonly ProviderPort[];
};

export function runChecks(ctx: DoctorContext): Check[] {
  return [
    ...checkNodeVersion(ctx.nodeVersion, ctx.bunPath),
    ...checkRuntimePaths(ctx.runtimeHome, ctx.platform),
    checkHookRuntime(ctx.runtimeHome, ctx.bunPath),
    ...checkProviders(ctx.registry, ctx.runtimeHome),
    ...checkProjectPolicy(ctx.root),
    ...checkCapabilities(ctx.root, ctx.runtimeHome),
    checkGlobalCommands(ctx.home),
  ];
}

export function exitCodeFor(checks: readonly Check[]): number {
  return checks.some((c) => c.level === "fail") ? 1 : 0;
}

export type CheckStatus = "OK" | "WARN" | "FAIL";

export type CheckReport = {
  id: string;
  name: string;
  status: CheckStatus;
  detail: string;
};

export type DoctorReport = {
  ok: boolean;
  failed: number;
  warned: number;
  checks: CheckReport[];
};

export function checkId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function toReport(checks: readonly Check[]): DoctorReport {
  const statuses: Record<CheckLevel, CheckStatus> = { ok: "OK", warn: "WARN", fail: "FAIL" };
  return {
    ok: exitCodeFor(checks) === 0,
    failed: checks.filter((check) => check.level === "fail").length,
    warned: checks.filter((check) => check.level === "warn").length,
    checks: checks.map((check) => ({
      id: checkId(check.name),
      name: check.name,
      status: statuses[check.level],
      detail: check.detail,
    })),
  };
}

export function formatReport(checks: readonly Check[]): string {
  const marks: Record<CheckLevel, string> = { ok: "OK  ", warn: "WARN", fail: "FAIL" };
  const lines = checks.map((c) => `${marks[c.level]}  ${c.name} — ${c.detail}`);
  const failed = checks.filter((c) => c.level === "fail").length;
  lines.push("");
  lines.push(failed === 0 ? "doctor: all checks passed" : `doctor: ${failed} issue(s)`);
  return lines.join("\n");
}

function realContext(): DoctorContext {
  const home = runtimeHome();
  const bunPath = findBunOnPath();
  writeRuntimeCache(home, bunPath);
  return {
    root: process.env.TLC_PROJECT_DIR ?? process.cwd(),
    home: homedir(),
    runtimeHome: home,
    platform: osPlatform(),
    nodeVersion: process.version,
    bunPath,
    registry: providers,
  };
}

if (import.meta.main) {
  const { json } = takeJsonFlag(process.argv.slice(2));
  const checks = runChecks(realContext());
  if (json) {
    emitJson(toReport(checks));
  } else {
    console.log(formatReport(checks));
  }
  process.exit(exitCodeFor(checks));
}
