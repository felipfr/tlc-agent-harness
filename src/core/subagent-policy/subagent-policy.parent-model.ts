import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectStateDir } from "../../platform/paths.ts";
import type { ModelParam, ParentModelSnapshot } from "./subagent-policy.types.ts";

const PARENT_MODEL_SCHEMA = "harness.parent-model.v1" as const;

type ParentModelFile = {
  schema: typeof PARENT_MODEL_SCHEMA;
  bySession: Record<string, ParentModelSnapshot>;
};

function parentModelPath(root: string): string {
  return join(projectStateDir(root), "parent-model.json");
}

function readFile(root: string): ParentModelFile {
  const path = parentModelPath(root);
  if (!existsSync(path)) {
    return { schema: PARENT_MODEL_SCHEMA, bySession: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ParentModelFile;
    if (parsed?.schema === PARENT_MODEL_SCHEMA && parsed.bySession) {
      return parsed;
    }
  } catch {}
  return { schema: PARENT_MODEL_SCHEMA, bySession: {} };
}

function writeFile(root: string, file: ParentModelFile): void {
  try {
    mkdirSync(projectStateDir(root), { recursive: true });
    writeFileSync(parentModelPath(root), `${JSON.stringify(file, null, 2)}\n`, "utf8");
  } catch {}
}

export function isFastParamTrue(params: unknown): boolean {
  if (!Array.isArray(params)) {
    return false;
  }
  for (const entry of params) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const row = entry as ModelParam;
    if (String(row.id ?? "").toLowerCase() === "fast" && String(row.value ?? "").toLowerCase() === "true") {
      return true;
    }
  }
  return false;
}

function parseBracketParams(model: string): { base: string; params: Record<string, string> } | null {
  const trimmed = model.trim();
  const match = /^([^[\]]+)\[([^\]]*)\]$/.exec(trimmed);
  const base = match?.[1];
  const rawParams = match?.[2];
  if (base === undefined || rawParams === undefined) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const part of rawParams.split(",")) {
    const piece = part.trim();
    if (!piece) {
      continue;
    }
    const eq = piece.indexOf("=");
    if (eq < 0) {
      params[piece.toLowerCase()] = "true";
      continue;
    }
    const key = piece.slice(0, eq).trim().toLowerCase();
    const value = piece
      .slice(eq + 1)
      .trim()
      .toLowerCase();
    if (key) {
      params[key] = value;
    }
  }
  return { base, params };
}

export function modelHasFastBracket(model: string): boolean {
  const parsed = parseBracketParams(model);
  return parsed?.params.fast === "true";
}

export function modelMatchesBlocked(model: string, patterns: string[]): string | null {
  const value = model.trim();
  if (!value) {
    return null;
  }
  if (modelHasFastBracket(value)) {
    return "fast=true";
  }
  for (const pattern of patterns) {
    try {
      if (new RegExp(pattern, "i").test(value)) {
        return pattern;
      }
    } catch {
      if (value.toLowerCase().includes(pattern.toLowerCase())) {
        return pattern;
      }
    }
  }
  return null;
}

export function isModelAllowlisted(model: string, allowed: string[]): boolean {
  if (!model) {
    return false;
  }
  if (modelHasFastBracket(model)) {
    return false;
  }
  return allowed.some((entry) => entry === model || model.startsWith(`${entry}[`));
}

export function computeFastFlag(model: string, modelParams: unknown, patterns: string[]): boolean {
  if (isFastParamTrue(modelParams)) {
    return true;
  }
  return modelMatchesBlocked(model, patterns) !== null;
}

export function candidateModelBlocked(
  model: string,
  patterns: string[],
  modelParams?: unknown,
): string | null {
  const fromSlug = modelMatchesBlocked(model, patterns);
  if (fromSlug) {
    return fromSlug;
  }
  if (isFastParamTrue(modelParams)) {
    return "model_params.fast=true";
  }
  return null;
}

export function upsertParentModelState(
  projectDir: string,
  sessionKey: string | undefined,
  input: { model?: string; model_params?: unknown },
  patterns: string[],
): ParentModelSnapshot | null {
  const key = sessionKey?.trim();
  if (!key) {
    return null;
  }
  const model = typeof input.model === "string" ? input.model : "";
  const hasParams = Array.isArray(input.model_params);
  if (!model && !hasParams) {
    return null;
  }
  const model_params = hasParams ? (input.model_params as ModelParam[]) : null;
  const fast = computeFastFlag(model, model_params, patterns);
  const snapshot: ParentModelSnapshot = {
    model,
    model_params,
    fast,
    updated_at: new Date().toISOString(),
  };

  const file = readFile(projectDir);
  file.bySession[key] = snapshot;
  writeFile(projectDir, file);
  return snapshot;
}

export function readParentModelState(
  projectDir: string,
  sessionKey: string | undefined,
): ParentModelSnapshot | null {
  const key = sessionKey?.trim();
  if (!key) {
    return null;
  }
  return readFile(projectDir).bySession[key] ?? null;
}

export function shouldDenyParentFast(opts: {
  enabled: boolean;
  projectDir: string;
  sessionKey: string | undefined;
  patterns: string[];
}): boolean {
  if (!opts.enabled) {
    return false;
  }
  const snap = readParentModelState(opts.projectDir, opts.sessionKey);
  if (!snap) {
    return false;
  }
  if (snap.fast) {
    return true;
  }
  return computeFastFlag(snap.model, snap.model_params, opts.patterns);
}
