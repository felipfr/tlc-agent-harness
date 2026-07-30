import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProviderCapabilities } from "../../contracts/capabilities.ts";
import type { HarnessEvent } from "../../contracts/harness-event.ts";
import { bootDir, loopsDir } from "../../platform/paths.ts";
import { sanitizeSegment } from "../../platform/sanitize.ts";
import type { BootResult, LoopCheck, LoopState } from "./turn.types.ts";

function loopPath(root: string, sessionKey: string): string {
  return join(loopsDir(root), `${sanitizeSegment(sessionKey)}.json`);
}

function readLoopState(root: string, sessionKey: string): LoopState | null {
  const path = loopPath(root, sessionKey);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LoopState;
  } catch {
    return null;
  }
}

function writeLoopState(root: string, state: LoopState): void {
  try {
    mkdirSync(loopsDir(root), { recursive: true });
    writeFileSync(loopPath(root, state.session_key), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch {}
}

export function currentLoopCount(root: string, sessionKey: string): number {
  return readLoopState(root, sessionKey)?.count ?? 0;
}

export function nextLoop(root: string, sessionKey: string): number {
  const count = currentLoopCount(root, sessionKey) + 1;
  writeLoopState(root, { session_key: sessionKey, count, updated_at: new Date().toISOString() });
  return count;
}

export function resetLoop(root: string, sessionKey: string): void {
  writeLoopState(root, { session_key: sessionKey, count: 0, updated_at: new Date().toISOString() });
}

export function checkLoopCap(count: number, maxLoops: number): LoopCheck {
  return { count, capReached: count > maxLoops };
}

export function effectiveLoopCount(event: HarnessEvent, capabilities: ProviderCapabilities): number {
  if (capabilities.nativeLoopCounter) {
    return event.loopCount ?? 0;
  }
  return currentLoopCount(event.projectDir, event.sessionKey);
}

function bootStampPath(root: string, sessionKey: string): string {
  return join(bootDir(root), sanitizeSegment(sessionKey));
}

export function markBooted(root: string, sessionKey: string): BootResult {
  const path = bootStampPath(root, sessionKey);
  if (existsSync(path)) {
    return { alreadyBooted: true };
  }
  try {
    mkdirSync(bootDir(root), { recursive: true });
    writeFileSync(path, new Date().toISOString(), "utf8");
  } catch {}
  return { alreadyBooted: false };
}
