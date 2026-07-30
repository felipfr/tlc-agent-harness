import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { flagsDir, projectConfigPath, projectStateDir, runtimeHome } from "../../platform/paths.ts";
import { DEFAULTS } from "./policy.defaults.ts";
import type { OperatorMode, PartialPolicy, Policy } from "./policy.types.ts";

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function deepMerge(base: Policy, patch: PartialPolicy): Policy {
  return {
    ...base,
    ...patch,
    format: { ...base.format, ...patch.format },
    grind: { ...base.grind, ...patch.grind },
    shipGate: { ...base.shipGate, ...patch.shipGate },
    subagents: { ...base.subagents, ...patch.subagents },
    docs: { ...base.docs, ...patch.docs },
    comments: { ...base.comments, ...patch.comments },
    obs: { ...base.obs, ...patch.obs },
    untrustedContent: { ...base.untrustedContent, ...patch.untrustedContent },
    shell: { ...base.shell, ...patch.shell },
    intelligence: {
      ...base.intelligence,
      ...patch.intelligence,
      lessons: {
        ...base.intelligence.lessons,
        ...patch.intelligence?.lessons,
      },
    },
    codePaths: patch.codePaths ?? base.codePaths,
    mcpPrime: patch.mcpPrime ?? base.mcpPrime,
    bootstrapExtra: patch.bootstrapExtra ?? base.bootstrapExtra,
  };
}

function flagExists(root: string, flagName: string): boolean {
  return existsSync(join(flagsDir(root), flagName));
}

function resolveMode(root: string, configured: OperatorMode): OperatorMode {
  const modeFile = join(projectStateDir(root), "harness-mode");
  if (existsSync(modeFile)) {
    const raw = readFileSync(modeFile, "utf8").trim().toLowerCase();
    if (raw === "paired" || raw === "solo" || raw === "heads-down") {
      return raw;
    }
  }
  if (flagExists(root, "heads-down")) {
    return "heads-down";
  }
  if (flagExists(root, "paired")) {
    return "paired";
  }
  return configured;
}

export function loadPolicy(root: string): Policy {
  const userFile = join(runtimeHome(), "config.json");
  const projectFile = projectConfigPath(root);
  const fromUser = readJsonFile<PartialPolicy>(userFile) ?? {};
  const fromProject = readJsonFile<PartialPolicy>(projectFile) ?? {};
  const merged = deepMerge(deepMerge(DEFAULTS, fromUser), fromProject);
  merged.mode = resolveMode(root, merged.mode);

  if (flagExists(root, "grind-on")) {
    merged.grind.enabled = true;
  }
  if (merged.mode === "heads-down") {
    merged.grind.enabled = true;
  }

  return merged;
}

export function isUnderCodePaths(relativePath: string, codePaths: string[]): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return codePaths.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}
