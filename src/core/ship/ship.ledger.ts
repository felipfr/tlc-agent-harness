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

export function hasRecentEvidence(evidenceDir: string, maxAgeHours: number): boolean {
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
      if (now - statSync(verdictPath).mtimeMs > maxAgeMs) {
        continue;
      }
      if (/\bPASS\b/i.test(readFileSync(verdictPath, "utf8"))) {
        return true;
      }
    } catch {}
  }
  return false;
}
