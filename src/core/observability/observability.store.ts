import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { appendRecord, readTail } from "../../platform/fs-jsonl.ts";
import { projectStateDir, runtimeSpoolPath, runtimeStateDir } from "../../platform/paths.ts";
import { sanitizeSegment } from "../../platform/sanitize.ts";
import type { AuditRecord, ObsEvent } from "./observability.types.ts";

export type SessionRollup = {
  session_id: string;
  provider: string;
  started_at: string;
  updated_at: string;
  models: Record<string, number>;
  tools: Record<string, { ok: number; fail: number; ms: number }>;
  subagents: Record<string, { count: number; models: Record<string, number> }>;
  gates: { pass: number; fail: number };
  denials: number;
  prompts: number;
  responses: number;
  thoughts: number;
  comped: number;
  shell: { allow: number; ask: number; deny: number };
  mcp: Record<string, number>;
  estimated_cost_usd: number;
  cost_incomplete: boolean;
  input_tokens: number;
  output_tokens: number;
  cost_alert_sent: boolean;
};

function safeMkdir(dir: string): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

export type SpoolStream = "obs" | "audit";

export type SpoolEnvelope = {
  repo: string;
  project: string;
  stream: SpoolStream;
  record: unknown;
};

export function spoolEnvelope(root: string, stream: SpoolStream, record: unknown): SpoolEnvelope {
  return { repo: root, project: basename(root), stream, record };
}

// hazard: best-effort by contract. The project's own state directory holds the authoritative copy, so a
// read-only runtime home, a full disk or a concurrent writer must degrade to project-only recording
// rather than change what the caller is told.
export function appendSpoolRecord(root: string, stream: SpoolStream, record: unknown): boolean {
  try {
    if (!safeMkdir(runtimeStateDir())) {
      return false;
    }
    appendRecord(runtimeSpoolPath(), spoolEnvelope(root, stream, record));
    return true;
  } catch {
    return false;
  }
}

export function appendObsRecord(root: string, file: string, event: ObsEvent, spool = false): boolean {
  if (!safeMkdir(projectStateDir(root))) {
    return false;
  }
  try {
    appendRecord(join(projectStateDir(root), file), event);
  } catch {
    return false;
  }
  if (spool) {
    appendSpoolRecord(root, "obs", event);
  }
  return true;
}

export function appendAuditRecord(root: string, record: AuditRecord, spool = false): boolean {
  if (!safeMkdir(projectStateDir(root))) {
    return false;
  }
  try {
    appendRecord(join(projectStateDir(root), "audit.jsonl"), record);
  } catch {
    return false;
  }
  if (spool) {
    appendSpoolRecord(root, "audit", record);
  }
  return true;
}

function spoolLineTimestamp(line: string): number | null {
  try {
    const parsed = JSON.parse(line) as SpoolEnvelope;
    const record = parsed.record as { ts?: unknown } | null;
    const ts = typeof record?.ts === "string" ? Date.parse(record.ts) : Number.NaN;
    return Number.isNaN(ts) ? null : ts;
  } catch {
    return null;
  }
}

// hazard: rewriting a file every repository on the machine appends to can drop a line written between the
// read and the rename. That is acceptable here and only here: the spool is a derived cross-repo view, and
// the per-project records it mirrors are never touched.
export function pruneSpool(retentionDays: number, now = Date.now()): number {
  const path = runtimeSpoolPath();
  if (!existsSync(path)) {
    return 0;
  }
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  let lines: string[] = [];
  try {
    lines = readFileSync(path, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0);
  } catch {
    return 0;
  }
  const kept = lines.filter((line) => {
    const ts = spoolLineTimestamp(line);
    return ts === null || ts >= cutoff;
  });
  if (kept.length === lines.length) {
    return 0;
  }
  try {
    writeFileSync(path, kept.length > 0 ? `${kept.join("\n")}\n` : "", "utf8");
  } catch {
    return 0;
  }
  return lines.length - kept.length;
}

export function readSignalEvents(root: string, file: string, limit = 200): ObsEvent[] {
  try {
    return readTail<ObsEvent>(join(projectStateDir(root), file), limit);
  } catch {
    return [];
  }
}

function rollupPath(root: string, sessionKey: string): string {
  return join(projectStateDir(root), "sessions", `${sanitizeSegment(sessionKey)}.json`);
}

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

export function newRollup(sessionKey: string, provider: string): SessionRollup {
  const now = new Date().toISOString();
  return {
    session_id: sessionKey,
    provider,
    started_at: now,
    updated_at: now,
    models: {},
    tools: {},
    subagents: {},
    gates: { pass: 0, fail: 0 },
    denials: 0,
    prompts: 0,
    responses: 0,
    thoughts: 0,
    comped: 0,
    shell: { allow: 0, ask: 0, deny: 0 },
    mcp: {},
    estimated_cost_usd: 0,
    cost_incomplete: false,
    input_tokens: 0,
    output_tokens: 0,
    cost_alert_sent: false,
  };
}

export function loadRollup(root: string, sessionKey: string, provider: string): SessionRollup {
  return readJson<SessionRollup>(rollupPath(root, sessionKey)) ?? newRollup(sessionKey, provider);
}

export function saveRollup(root: string, rollup: SessionRollup): boolean {
  const dir = join(projectStateDir(root), "sessions");
  if (!safeMkdir(dir)) {
    return false;
  }
  rollup.updated_at = new Date().toISOString();
  try {
    writeFileSync(rollupPath(root, rollup.session_id), `${JSON.stringify(rollup, null, 2)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

export function getRollup(root: string, sessionKey: string): SessionRollup | null {
  return readJson<SessionRollup>(rollupPath(root, sessionKey));
}

export function pruneObs(root: string, retentionDays: number): void {
  const dir = join(projectStateDir(root), "sessions");
  if (!existsSync(dir)) {
    return;
  }
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const full = join(dir, name);
    const data = readJson<SessionRollup>(full);
    if (data && Date.parse(data.updated_at) < cutoff) {
      try {
        unlinkSync(full);
      } catch {}
    }
  }
}
