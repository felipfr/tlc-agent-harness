import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectStateDir } from "../../platform/paths.ts";
import { sanitizeSegment } from "../../platform/sanitize.ts";

function markerDir(root: string): string {
  return join(projectStateDir(root), "untrusted");
}

export function markerPath(root: string, sessionKey: string): string {
  return join(markerDir(root), `${sanitizeSegment(sessionKey)}.marker`);
}

export function wasFramingInjected(root: string, sessionKey: string): boolean {
  return existsSync(markerPath(root, sessionKey));
}

export function markFramingInjected(root: string, sessionKey: string): void {
  try {
    mkdirSync(markerDir(root), { recursive: true });
    writeFileSync(markerPath(root, sessionKey), new Date().toISOString());
  } catch {}
}

// why: the turn boundary is the prompt, so the marker is cleared there rather than expiring on a timer.
// A failure to clear costs one missing framing, never a duplicate on every tool call.
export function clearFramingMarker(root: string, sessionKey: string): void {
  try {
    rmSync(markerPath(root, sessionKey), { force: true });
  } catch {}
}
