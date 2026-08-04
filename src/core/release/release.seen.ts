import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "../../platform/fs-atomic.ts";
import { projectStateDir } from "../../platform/paths.ts";

/**
 * why: mirrors the capability seen marker rather than inventing a second mechanism. That marker already established
 * both the shape and the reason — an announcement that repeats becomes noise, and noise is filtered out by the
 * reader, which is how a real warning gets missed ([/decisions/ad-031.md](/decisions/ad-031.md)).
 *
 * invariant: per project, not per machine. Two repositories on one install each hear about a decision once, because
 * whether a decision matters is a property of the project's config, not of the machine.
 */
export type ReleaseSeen = { revision: string; updatedAt?: string };

function seenPath(projectDir: string): string {
  return join(projectStateDir(projectDir), "release-seen.json");
}

export function readReleaseSeen(projectDir: string): ReleaseSeen | null {
  const path = seenPath(projectDir);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ReleaseSeen;
    return typeof parsed?.revision === "string" && parsed.revision !== "" ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeReleaseSeen(projectDir: string, revision: string): Promise<void> {
  await writeJsonAtomic(seenPath(projectDir), {
    revision,
    updatedAt: new Date().toISOString(),
  } satisfies ReleaseSeen);
}
