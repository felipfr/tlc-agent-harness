import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { appendRecord, readTail } from "../../platform/fs-jsonl.ts";
import { projectStateDir } from "../../platform/paths.ts";
import type { ShipLedgerRow } from "./ship.types.ts";

export function shipLedgerPath(root: string): string {
  return join(projectStateDir(root), "ship-ledger.jsonl");
}

export function appendShipLedger(root: string, row: Omit<ShipLedgerRow, "ts"> & { ts?: string }): void {
  const full: ShipLedgerRow = { ...row, ts: row.ts ?? new Date().toISOString() };
  appendRecord(shipLedgerPath(root), full);
}

export function readShipLedger(root: string): ShipLedgerRow[] {
  return readTail<ShipLedgerRow>(shipLedgerPath(root), Number.MAX_SAFE_INTEGER);
}

/**
 * hazard: this asked one question — is the verdict fresh? — and freshness is not what makes evidence evidence. A
 * verdict written ten minutes ago passed while the code it supposedly certified changed five minutes ago. Evidence
 * that predates the change proves nothing about it, and the gate accepted it silently
 * ([/decisions/ad-027.md](/decisions/ad-027.md)).
 *
 * invariant: ordering is checked first and age second. Age still earns its place — it catches a verdict left over
 * from last week when nothing changed at all — but only ordering can see the case above.
 *
 * why: `notBeforeMs` is a parameter rather than something read here, so the caller supplies the timestamp it
 * already has. When it is absent the age window decides alone, which is the pre-existing behaviour: a missing
 * input must not fail closed on a gate that blocks a stop.
 */
export function hasRecentEvidence(
  evidenceDir: string,
  maxAgeHours: number,
  notBeforeMs?: number,
): boolean {
  if (!existsSync(evidenceDir)) {
    return false;
  }
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const now = Date.now();
  for (const entry of readdirSync(evidenceDir)) {
    const verdictPath = join(evidenceDir, entry, "90-verdict.txt");
    if (!existsSync(verdictPath)) {
      continue;
    }
    try {
      const writtenAt = statSync(verdictPath).mtimeMs;
      if (notBeforeMs !== undefined && writtenAt < notBeforeMs) {
        continue;
      }
      if (now - writtenAt > maxAgeMs) {
        continue;
      }
      if (/\bPASS\b/i.test(readFileSync(verdictPath, "utf8"))) {
        return true;
      }
    } catch {}
  }
  return false;
}

/**
 * why: the newest mtime among the files the turn changed. The stop path already has that list, so ordering costs
 * a stat per changed file and no git call. Returns undefined when there is nothing to compare against, which is
 * the signal to let the age window decide.
 */
export function newestChangeMs(root: string, relativePaths: string[]): number | undefined {
  let newest: number | undefined;
  for (const relative of relativePaths) {
    try {
      const at = statSync(join(root, relative)).mtimeMs;
      if (newest === undefined || at > newest) {
        newest = at;
      }
    } catch {}
  }
  return newest;
}
