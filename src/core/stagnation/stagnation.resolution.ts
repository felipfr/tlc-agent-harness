import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectStateDir } from "../../platform/paths.ts";

/**
 * The harness computes an identity for a failure, counts its repeats to detect stagnation, and used to delete the
 * record at the exact moment the gate went green — destroying the pairing of *that failure* with *what resolved
 * it*. That pairing is the one thing nothing else has, because nothing else holds a failure fingerprint and the
 * diff in the same process ([/decisions/ad-028.md](/decisions/ad-028.md)).
 *
 * invariant: this is history, never instruction. AD-024 established that a plan names files from evidence and
 * never from proximity; a previous resolution is evidence, and presenting it as "edit these" would reintroduce
 * exactly the harm that decision removed.
 */
export type Resolution = {
  /** Files that changed between the failing state and the passing one. */
  files: string[];
  /** ISO timestamp of the resolution, so the most recent one wins when a fingerprint is resolved twice. */
  at: string;
  /** How the gate was named when it failed, so a reader knows which gate this history belongs to. */
  gate: string;
};

export type ResolutionStore = Record<string, Resolution>;

/**
 * why: bounded because this file is read on the failure path, which runs while an operator waits. The bound is
 * applied by dropping the oldest resolutions, so a long-lived repository keeps the recent ones rather than the
 * first ones it ever saw.
 */
export const MAX_RESOLUTIONS = 200;

/** why: at most eight, matching the plan's own file-list cap. A longer list stops being a lead and becomes noise. */
export const MAX_FILES_PER_RESOLUTION = 8;

function storePath(root: string): string {
  return join(projectStateDir(root), "fingerprint-resolutions.json");
}

export function readResolutions(root: string): ResolutionStore {
  const path = storePath(root);
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ResolutionStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function prune(store: ResolutionStore): ResolutionStore {
  const entries = Object.entries(store);
  if (entries.length <= MAX_RESOLUTIONS) {
    return store;
  }
  const kept = entries.sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, MAX_RESOLUTIONS);
  return Object.fromEntries(kept);
}

export function recordResolution(
  root: string,
  fingerprint: string,
  resolution: Resolution,
): ResolutionStore {
  const store = readResolutions(root);
  store[fingerprint] = {
    ...resolution,
    files: resolution.files.slice(0, MAX_FILES_PER_RESOLUTION),
  };
  const pruned = prune(store);
  try {
    mkdirSync(projectStateDir(root), { recursive: true });
    writeFileSync(storePath(root), `${JSON.stringify(pruned, null, 2)}\n`, "utf8");
  } catch {}
  return pruned;
}

export function resolutionFor(root: string, fingerprint: string): Resolution | null {
  return readResolutions(root)[fingerprint] ?? null;
}

/**
 * invariant: past tense, and no imperative. The wording is the whole safeguard here — the same list phrased as an
 * instruction would send an agent to edit files that may be irrelevant this time, which is the AD-021 and AD-024
 * harm arriving through a third door.
 */
export function resolutionHistoryLine(resolution: Resolution): string {
  return `History: this same ${resolution.gate} failure was resolved once before, after changes to ${resolution.files.join(", ")}. That is a record of what happened, not a list to edit — confirm it against this failure before acting on it.`;
}
