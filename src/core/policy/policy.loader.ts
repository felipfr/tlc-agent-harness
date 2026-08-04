import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { flagsDir, projectConfigPath, runtimeHome } from "../../platform/paths.ts";
import { DEFAULTS } from "./policy.defaults.ts";
import { type PostureResolution, resolvePosture } from "./policy.posture.ts";
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
    observe: { ...base.observe, ...patch.observe },
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

type ConfigPair = { fromUser: PartialPolicy; fromProject: PartialPolicy };

function readConfigPair(root: string): ConfigPair {
  return {
    fromUser: readJsonFile<PartialPolicy>(join(runtimeHome(), "config.json")) ?? {},
    fromProject: readJsonFile<PartialPolicy>(projectConfigPath(root)) ?? {},
  };
}

// hazard: written twice at first — once here and once inline in `loadPolicy` — so a change to which config wins
// moved one caller and left the other. A discrimination sensor caught it: reversing the precedence in one place
// failed one suite and left the other fully green.
function postureOf(root: string, pair: ConfigPair): PostureResolution {
  return resolvePosture(root, pair.fromProject.mode ?? pair.fromUser.mode);
}

/**
 * invariant: the resolution the loader itself applies, origin included. `status` and `doctor` need the origin
 * and the rejected value, which `Policy.mode` cannot carry — reading it from here is what stops either of them
 * from recomputing a posture and reporting the opposite of what the hooks resolved (AD-020).
 */
export function resolveProjectPosture(root: string): PostureResolution {
  return postureOf(root, readConfigPair(root));
}

export function loadPolicy(root: string): Policy {
  const pair = readConfigPair(root);
  const merged = deepMerge(deepMerge(DEFAULTS, pair.fromUser), pair.fromProject);
  merged.mode = postureOf(root, pair).mode;

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
