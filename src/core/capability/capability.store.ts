import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic } from "../../platform/fs-atomic.ts";
import { projectConfigPath, projectStateDir, runtimeHome } from "../../platform/paths.ts";
import type { CapabilityCatalog, RuntimeSeen } from "./capability.types.ts";

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export function catalogPath(home = runtimeHome()): string {
  return join(home, "capabilities", "catalog.json");
}

export function loadCatalog(home = runtimeHome()): CapabilityCatalog | null {
  const raw = readJson<CapabilityCatalog>(catalogPath(home));
  if (!raw || typeof raw.catalogVersion !== "number" || !Array.isArray(raw.capabilities)) {
    return null;
  }
  return raw;
}

export function readProjectPolicyRaw(projectDir: string): Record<string, unknown> | null {
  return readJson<Record<string, unknown>>(projectConfigPath(projectDir));
}

function runtimeSeenPath(projectDir: string): string {
  return join(projectStateDir(projectDir), "runtime-seen.json");
}

export function readRuntimeSeen(projectDir: string): RuntimeSeen {
  const raw = readJson<RuntimeSeen>(runtimeSeenPath(projectDir));
  if (!raw || typeof raw.catalogVersion !== "number" || raw.catalogVersion < 0) {
    return { catalogVersion: 0 };
  }
  return raw;
}

export async function writeRuntimeSeen(projectDir: string, catalogVersion: number): Promise<void> {
  await writeJsonAtomic(runtimeSeenPath(projectDir), {
    catalogVersion,
    updatedAt: new Date().toISOString(),
  } satisfies RuntimeSeen);
}
