export type CatalogCapability = {
  id: string;
  configPath: string;
  title: string;
  benefit: string;
  tradeOff: string;
  defaultOn: boolean;
  sinceCatalogVersion: number;
  /** Follow-up values the wizard collects when the operator accepts. Presentation only. */
  asks?: string[];
  /** A stated recommendation, where there is one worth stating. */
  recommend?: "on" | "off";
};

export type CapabilityCatalog = {
  catalogVersion: number;
  capabilities: CatalogCapability[];
};

export type RuntimeSeen = {
  catalogVersion: number;
  updatedAt?: string;
};

export const ENABLE_HINT =
  'Enable: ask the agent "setup harness" (harness-init skill) or edit .tlc/harness/config.json';
