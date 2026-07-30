import { homedir } from "node:os";
import { join } from "node:path";

function harnessDir(root: string): string {
  return join(root, ".tlc", "harness");
}

export function runtimeHome(): string {
  return process.env.TLC_HOME ?? join(homedir(), ".tlc", "harness");
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

export function claudeConfigDir(): string {
  const custom = process.env.CLAUDE_CONFIG_DIR?.trim();
  return custom && custom.length > 0 ? custom : join(homedir(), ".claude");
}

export function cursorConfigDir(): string {
  const custom = process.env.CURSOR_CONFIG_DIR?.trim();
  return custom && custom.length > 0 ? custom : join(homedir(), ".cursor");
}
