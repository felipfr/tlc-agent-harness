import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectStateDir } from "../../platform/paths.ts";
import type { ShellStallEntry, ShellStallStore } from "./shell-policy.types.ts";

function storePath(root: string): string {
  return join(projectStateDir(root), "shell-stall.json");
}

function readStore(root: string): ShellStallStore {
  const path = storePath(root);
  if (!existsSync(path)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ShellStallStore;
  } catch {
    return {};
  }
}

function writeStore(root: string, store: ShellStallStore): void {
  try {
    mkdirSync(projectStateDir(root), { recursive: true });
    writeFileSync(storePath(root), `${JSON.stringify(store, null, 2)}\n`, "utf8");
  } catch {}
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ").slice(0, 300);
}

export function trackShellCommand(root: string, sessionKey: string, command: string): number {
  const normalized = normalizeCommand(command);
  if (!normalized) {
    return 0;
  }
  const store = readStore(root);
  const current: ShellStallEntry = store[sessionKey] ?? { hits: 0 };
  const next: ShellStallEntry =
    current.lastCommand === normalized
      ? { lastCommand: normalized, hits: current.hits + 1 }
      : { lastCommand: normalized, hits: 1 };
  store[sessionKey] = next;
  writeStore(root, store);
  return next.hits;
}

export function clearShellStall(root: string, sessionKey: string): void {
  const store = readStore(root);
  store[sessionKey] = { hits: 0 };
  writeStore(root, store);
}

export function shellStallHits(root: string, sessionKey: string): number {
  return readStore(root)[sessionKey]?.hits ?? 0;
}
