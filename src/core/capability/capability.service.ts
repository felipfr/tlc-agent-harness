import { type CapabilityCatalog, type CatalogCapability, ENABLE_HINT } from "./capability.types.ts";

export function resolveConfigPath(policy: Record<string, unknown>, configPath: string): unknown {
  let current: unknown = policy;
  for (const part of configPath.split(".").filter(Boolean)) {
    if (!current || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function isAvailableNotEnabled(policy: Record<string, unknown>, cap: CatalogCapability): boolean {
  const value = resolveConfigPath(policy, cap.configPath);
  return cap.defaultOn ? value === false : value !== true;
}

export function listAvailableNotEnabled(
  policy: Record<string, unknown>,
  catalog: CapabilityCatalog,
): CatalogCapability[] {
  return catalog.capabilities.filter((cap) => isAvailableNotEnabled(policy, cap));
}

export function listNewlyAnnounceable(
  policy: Record<string, unknown>,
  catalog: CapabilityCatalog,
  seenCatalogVersion: number,
): CatalogCapability[] {
  return listAvailableNotEnabled(policy, catalog).filter(
    (cap) => cap.sinceCatalogVersion > seenCatalogVersion,
  );
}

export function formatCapabilityDigest(caps: CatalogCapability[]): string {
  const lines = ["Available for this project (not enabled yet):", ""];
  for (const cap of caps) {
    lines.push(`• ${cap.title}`);
    lines.push(`  Benefit:  ${cap.benefit}`);
    lines.push(`  Trade-off: ${cap.tradeOff}`);
    lines.push("");
  }
  lines.push(ENABLE_HINT);
  return lines.join("\n").trimEnd();
}

// hazard: this prefixed "WARN:" while the row it lands in already carries its level, so an operator read the word
// twice. Seen in a real doctor run ([/decisions/ad-034.md](/decisions/ad-034.md)).
export function formatDoctorWarn(cap: CatalogCapability): string {
  return `${cap.title} off — ${cap.tradeOff} — ${ENABLE_HINT}`;
}

/**
 * hazard: every capability that was merely *not enabled* produced a warning, so a healthy install printed nine of
 * them and the two rows that needed attention were buried in the middle. An optional capability nobody switched on is
 * inventory, not a fault, and a warning that fires on a healthy install teaches the reader to skip warnings — which
 * is how the row that mattered got missed ([/decisions/ad-034.md](/decisions/ad-034.md)).
 */
export function formatAvailableInventory(caps: readonly CatalogCapability[]): string {
  return `${caps.length} available and not enabled: ${caps.map((cap) => cap.id).join(", ")}. ${ENABLE_HINT}`;
}
