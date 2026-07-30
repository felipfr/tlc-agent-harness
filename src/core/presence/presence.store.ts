import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { presenceDir } from "../../platform/paths.ts";
import { sanitizeSegment } from "../../platform/sanitize.ts";
import type { PresenceRecord } from "./presence.types.ts";

export function presenceSessionKey(provider: string, session: string): string {
  return `${provider}-${session}`;
}

function presencePath(root: string, provider: string, session: string): string {
  return join(presenceDir(root), `${sanitizeSegment(presenceSessionKey(provider, session))}.json`);
}

export function readPresenceRecord(root: string, provider: string, session: string): PresenceRecord | null {
  const path = presencePath(root, provider, session);
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PresenceRecord;
  } catch {
    return null;
  }
}

export function writePresenceRecord(root: string, record: PresenceRecord): void {
  try {
    mkdirSync(presenceDir(root), { recursive: true });
    writeFileSync(
      presencePath(root, record.provider, record.session),
      `${JSON.stringify(record, null, 2)}\n`,
      "utf8",
    );
  } catch {}
}

export function deletePresenceRecord(root: string, provider: string, session: string): void {
  try {
    rmSync(presencePath(root, provider, session), { force: true });
  } catch {}
}

export function listPresenceRecords(root: string): PresenceRecord[] {
  const dir = presenceDir(root);
  if (!existsSync(dir)) {
    return [];
  }
  const records: PresenceRecord[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    try {
      records.push(JSON.parse(readFileSync(join(dir, entry), "utf8")) as PresenceRecord);
    } catch {}
  }
  return records;
}
