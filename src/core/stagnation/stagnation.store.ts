import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectStateDir } from "../../platform/paths.ts";
import type { FingerprintStore } from "./stagnation.types.ts";

function storePath(root: string): string {
  return join(projectStateDir(root), "fingerprint.json");
}

function readStore(root: string): FingerprintStore {
  const path = storePath(root);
  if (!existsSync(path)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as FingerprintStore;
  } catch {
    return {};
  }
}

function writeStore(root: string, store: FingerprintStore): void {
  try {
    mkdirSync(projectStateDir(root), { recursive: true });
    writeFileSync(storePath(root), `${JSON.stringify(store, null, 2)}\n`, "utf8");
  } catch {}
}

export function trackFingerprint(root: string, sessionKey: string, fingerprint: string): number {
  const store = readStore(root);
  const current = store[sessionKey] ?? { hits: 0 };
  const next =
    current.last === fingerprint
      ? { last: fingerprint, hits: current.hits + 1 }
      : { last: fingerprint, hits: 1 };
  store[sessionKey] = next;
  writeStore(root, store);
  return next.hits;
}

export function fingerprintHits(root: string, sessionKey: string): number {
  return readStore(root)[sessionKey]?.hits ?? 0;
}

export function clearFingerprint(root: string, sessionKey: string): void {
  const store = readStore(root);
  store[sessionKey] = { hits: 0 };
  writeStore(root, store);
}
