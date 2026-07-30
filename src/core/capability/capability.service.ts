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

export function formatDoctorWarn(cap: CatalogCapability): string {
  return `WARN: ${cap.title} off — ${cap.tradeOff} — ${ENABLE_HINT}`;
}
