import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeHome } from "./paths.ts";

export type VendorPool = "cursor_models" | "anthropic_models" | "other_models" | "auto" | "unknown";
export type NeutralPool = "provider_native" | "other" | "auto" | "unknown";
export type CostSource = "override" | "provider" | "litellm" | "missing";

export type ModelPriceEntry = {
  displayName?: string;
  provider?: string;
  promptPer1M?: number;
  completionPer1M?: number;
  cacheWritePer1M?: number;
  cacheReadPer1M?: number;
  pool?: VendorPool;
  billing?: "metered" | "included" | "unknown";
  contextWindow?: number;
};

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export type CostEstimate = {
  costUsd: number | null;
  billing: "metered" | "included" | "unknown";
  pool: VendorPool;
  source: CostSource;
  catalogKey?: string;
};

type PriceTable = Record<string, ModelPriceEntry>;
type AliasTable = Record<string, string>;

const VENDOR_TO_NEUTRAL_POOL: Record<VendorPool, NeutralPool> = {
  cursor_models: "provider_native",
  anthropic_models: "provider_native",
  other_models: "other",
  auto: "auto",
  unknown: "unknown",
};

export function mapPoolToNeutral(pool: VendorPool): NeutralPool {
  return VENDOR_TO_NEUTRAL_POOL[pool];
}

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function stripMeta(table: PriceTable | null): PriceTable {
  if (!table) {
    return {};
  }
  const { _meta: _ignored, ...rest } = table as PriceTable & { _meta?: unknown };
  return rest;
}

export function slugifyModelName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[[\]]/g, "")
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9.+]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function candidatesFor(model: string, aliases: AliasTable): string[] {
  const trimmed = model.trim();
  const out: string[] = [];
  const push = (v: string | undefined) => {
    if (v && !out.includes(v)) {
      out.push(v);
    }
  };
  push(trimmed);
  push(aliases[trimmed]);
  push(slugifyModelName(trimmed));
  push(aliases[slugifyModelName(trimmed)]);
  if (trimmed.includes("/")) {
    push(trimmed.slice(trimmed.lastIndexOf("/") + 1));
  }
  const noEffort = trimmed.replace(/-(high|medium|low|max|fast|thinking)$/i, "");
  if (noEffort !== trimmed) {
    push(noEffort);
    push(aliases[noEffort]);
    push(slugifyModelName(noEffort));
  }
  return out;
}

function fuzzyFind(table: PriceTable, needle: string): { key: string; entry: ModelPriceEntry } | undefined {
  const direct = table[needle];
  if (direct) {
    return { key: needle, entry: direct };
  }
  for (const [key, entry] of Object.entries(table)) {
    if (needle.startsWith(key) || key.startsWith(needle)) {
      return { key, entry };
    }
  }
  return undefined;
}

function overridesPath(): string {
  return join(runtimeHome(), "model-prices.json");
}

function providerNativePath(provider: string): string {
  return join(runtimeHome(), `model-prices.${provider}.json`);
}

function litellmPath(): string {
  return join(runtimeHome(), "model-prices.litellm.json");
}

function aliasesPath(): string {
  return join(runtimeHome(), "model-aliases.json");
}

export type PriceResolution = {
  entry: ModelPriceEntry;
  key: string;
  source: "override" | "provider" | "litellm";
};

export function resolveModelPrice(provider: string, model: string): PriceResolution | undefined {
  const trimmed = model.trim();
  if (!trimmed) {
    return undefined;
  }

  const overrides = stripMeta(readJsonFile<PriceTable>(overridesPath()));
  const native = stripMeta(readJsonFile<PriceTable>(providerNativePath(provider)));
  const litellm = stripMeta(readJsonFile<PriceTable>(litellmPath()));
  const aliases = readJsonFile<AliasTable>(aliasesPath()) ?? {};

  const candidates = candidatesFor(trimmed, aliases);

  for (const id of candidates) {
    const entry = overrides[id];
    if (entry) {
      return { entry, key: id, source: "override" };
    }
  }
  for (const id of candidates) {
    const entry = native[id];
    if (entry) {
      return { entry, key: id, source: "provider" };
    }
  }
  for (const id of candidates) {
    const entry = litellm[id];
    if (entry) {
      return { entry, key: id, source: "litellm" };
    }
  }

  const slug = slugifyModelName(trimmed);
  const fuzzyOverride = fuzzyFind(overrides, slug);
  if (fuzzyOverride) {
    return { ...fuzzyOverride, source: "override" };
  }
  const fuzzyNative = fuzzyFind(native, slug);
  if (fuzzyNative) {
    return { ...fuzzyNative, source: "provider" };
  }
  const fuzzyLitellm = fuzzyFind(litellm, slug);
  if (fuzzyLitellm) {
    return { ...fuzzyLitellm, source: "litellm" };
  }

  return undefined;
}

export function estimateCostUsd(
  provider: string,
  model: string | undefined,
  usage: TokenUsage,
): CostEstimate {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const cacheReadTokens = usage.cacheReadTokens ?? 0;
  const cacheWriteTokens = usage.cacheWriteTokens ?? 0;

  if (!model || (inputTokens <= 0 && outputTokens <= 0 && cacheReadTokens <= 0 && cacheWriteTokens <= 0)) {
    return { costUsd: null, billing: "unknown", pool: "unknown", source: "missing" };
  }

  const resolved = resolveModelPrice(provider, model);
  if (!resolved) {
    return { costUsd: null, billing: "unknown", pool: "unknown", source: "missing" };
  }

  const { entry, key, source } = resolved;
  const pool = entry.pool ?? "unknown";

  if (entry.billing === "included") {
    return { costUsd: null, billing: "included", pool, source, catalogKey: key };
  }

  if (typeof entry.promptPer1M !== "number" || typeof entry.completionPer1M !== "number") {
    return { costUsd: null, billing: entry.billing ?? "unknown", pool, source, catalogKey: key };
  }

  let costUsd =
    (inputTokens / 1_000_000) * entry.promptPer1M + (outputTokens / 1_000_000) * entry.completionPer1M;

  if (typeof entry.cacheReadPer1M === "number" && cacheReadTokens > 0) {
    costUsd += (cacheReadTokens / 1_000_000) * entry.cacheReadPer1M;
  }
  if (typeof entry.cacheWritePer1M === "number" && cacheWriteTokens > 0) {
    costUsd += (cacheWriteTokens / 1_000_000) * entry.cacheWritePer1M;
  }

  return { costUsd, billing: "metered", pool, source, catalogKey: key };
}
