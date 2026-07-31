import { homedir } from "node:os";
import { join } from "node:path";

function harnessDir(root: string): string {
  return join(root, ".tlc", "harness");
}

export function runtimeHome(): string {
  return process.env.TLC_HOME ?? join(homedir(), ".tlc", "harness");
}

export function runtimeStateDir(): string {
  return join(runtimeHome(), "state");
}

// why: one file for every repository on the machine. Per-repo state stays authoritative; this is the
// cross-repo view, which cannot exist under any single project's state directory.
export function runtimeSpoolPath(): string {
  return join(runtimeStateDir(), "obs-spool.jsonl");
}

export function projectConfigPath(root: string): string {
  return join(harnessDir(root), "config.json");
}

export function projectStateDir(root: string): string {
  return join(harnessDir(root), "state");
}

export function flagsDir(root: string): string {
  return join(projectStateDir(root), "flags");
}

export function presenceDir(root: string): string {
  return join(projectStateDir(root), "presence");
}

export function loopsDir(root: string): string {
  return join(projectStateDir(root), "loops");
}

export function bootDir(root: string): string {
  return join(projectStateDir(root), "boot");
}

// why: inside the state directory on purpose — the baseline that proves the policy was not switched off
// inherits the same protection as the policy itself.
export function policyBaselineDir(root: string): string {
  return join(projectStateDir(root), "policy-baseline");
}

export function claudeConfigDir(): string {
  const custom = process.env.CLAUDE_CONFIG_DIR?.trim();
  return custom && custom.length > 0 ? custom : join(homedir(), ".claude");
}

export function cursorConfigDir(): string {
  const custom = process.env.CURSOR_CONFIG_DIR?.trim();
  return custom && custom.length > 0 ? custom : join(homedir(), ".cursor");
}
