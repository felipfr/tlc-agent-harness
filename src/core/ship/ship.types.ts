export type ShipClaimKind = "structured";

export type ShipClaim = {
  kind: ShipClaimKind;
  snippet: string;
};

export type ShipLedgerEvent = "claim" | "challenge" | "pass";

export type ShipLedgerRow = {
  ts: string;
  provider: string;
  event: ShipLedgerEvent;
  claimKind?: ShipClaimKind;
  gate?: "ship" | "empty-diff";
  files?: string[];
  evidenceDir?: string | null;
  detail?: string;
};
