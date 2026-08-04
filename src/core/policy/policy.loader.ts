import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { flagsDir, projectConfigPath, projectStateDir, runtimeHome } from "../../platform/paths.ts";
import { DEFAULTS } from "./policy.defaults.ts";
import { resolvePosture } from "./policy.posture.ts";
import type { PartialPolicy, Policy } from "./policy.types.ts";

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
    planGate: { ...base.planGate, ...patch.planGate },
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

export function loadPolicy(root: string): Policy {
  const userFile = join(runtimeHome(), "config.json");
  const projectFile = projectConfigPath(root);
  const fromUser = readJsonFile<PartialPolicy>(userFile) ?? {};
  const fromProject = readJsonFile<PartialPolicy>(projectFile) ?? {};
  const merged = deepMerge(deepMerge(DEFAULTS, fromUser), fromProject);
  // invariant: one resolver decides posture, so status and doctor cannot disagree with the hooks.
  merged.mode = resolvePosture(root, fromProject.mode ?? fromUser.mode).mode;

  // why: grind is decided by its own switch and its own flag. Posture used to force it on, which meant a
  // surfacing preference silently overrode a capability with its own documented trade-off — the AD-020 defect.
  // Verification does not move when posture moves.
  if (flagExists(root, "grind-on")) {
    merged.grind.enabled = true;
  }

  return merged;
}

export function isUnderCodePaths(relativePath: string, codePaths: string[]): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return codePaths.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}
