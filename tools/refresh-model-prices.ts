#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS_HOME = join(dirname(fileURLToPath(import.meta.url)), "..");
const CURSOR_DOCS_URL = "https://cursor.com/docs/models-and-pricing.md";
const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/litellm/model_prices_and_context_window_backup.json";

type PriceEntry = {
  displayName?: string;
  provider?: string;
  promptPer1M?: number;
  completionPer1M?: number;
  cacheWritePer1M?: number;
  cacheReadPer1M?: number;
  pool?: "cursor_models" | "other_models" | "auto" | "unknown";
  billing?: "metered" | "included" | "unknown";
  contextWindow?: number;
};

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9.+]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseMoney(cell: string): number | undefined {
  const t = cell.trim();
  if (!t || t === "-" || t === "—" || t.toLowerCase() === "n/a") {
    return undefined;
  }
  const m = t.replace(/,/g, "").match(/\$?\s*([0-9]*\.?[0-9]+)/);
  if (!m) {
    return undefined;
  }
  return Number(m[1]);
}

function stripCell(cell: string): string {
  return cell
    .trim()
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*/g, "")
    .trim();
}

function inferPool(displayName: string, provider: string): PriceEntry["pool"] {
  const n = displayName.toLowerCase();
  if (n === "auto cost" || n.startsWith("auto ")) {
    return "auto";
  }
  if (provider.toLowerCase() === "cursor" || n.includes("composer") || n.includes("grok 4.5")) {
    return "cursor_models";
  }
  return "other_models";
}

function parseCursorDocs(md: string): Record<string, PriceEntry> {
  const out: Record<string, PriceEntry> = {};
  const lines = md.split("\n");
  let inTable = false;

  for (const line of lines) {
    if (!line.startsWith("|")) {
      if (inTable) {
        break;
      }
      continue;
    }
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 6) {
      continue;
    }
    const [cell0 = "", cell1 = "", cell2 = "", cell3 = "", cell4 = "", cell5 = ""] = cells;
    if (cell0.toLowerCase() === "model" || cell0.startsWith("---") || cell0.includes("---")) {
      inTable = true;
      continue;
    }
    if (!inTable) {
      continue;
    }

    const displayName = stripCell(cell0);
    const provider = stripCell(cell1);
    const promptPer1M = parseMoney(cell2);
    const cacheWritePer1M = parseMoney(cell3);
    const cacheReadPer1M = parseMoney(cell4);
    const completionPer1M = parseMoney(cell5);
    if (!displayName || promptPer1M === undefined || completionPer1M === undefined) {
      continue;
    }

    const key = slugify(displayName);
    out[key] = {
      displayName,
      provider,
      promptPer1M,
      completionPer1M,
      cacheWritePer1M,
      cacheReadPer1M,
      pool: inferPool(displayName, provider),
      billing: "metered",
    };
  }

  return out;
}

type LiteLlmEntry = {
  max_input_tokens?: number;
  max_tokens?: number;
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
  litellm_provider?: string;
};

function parseLiteLlm(raw: Record<string, LiteLlmEntry>): Record<string, PriceEntry> {
  const out: Record<string, PriceEntry> = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (id === "sample_spec") {
      continue;
    }
    const contextWindow =
      typeof entry.max_input_tokens === "number" ? entry.max_input_tokens : entry.max_tokens;
    const compact: PriceEntry = {
      displayName: id,
      provider: entry.litellm_provider,
      pool: "unknown",
      billing: "metered",
    };
    if (typeof contextWindow === "number" && contextWindow > 0) {
      compact.contextWindow = contextWindow;
    }
    if (typeof entry.input_cost_per_token === "number" && typeof entry.output_cost_per_token === "number") {
      compact.promptPer1M = entry.input_cost_per_token * 1_000_000;
      compact.completionPer1M = entry.output_cost_per_token * 1_000_000;
    } else {
      continue;
    }
    if (typeof entry.cache_read_input_token_cost === "number") {
      compact.cacheReadPer1M = entry.cache_read_input_token_cost * 1_000_000;
    }
    if (typeof entry.cache_creation_input_token_cost === "number") {
      compact.cacheWritePer1M = entry.cache_creation_input_token_cost * 1_000_000;
    }
    out[id] = compact;
    const slug = slugify(id);
    if (slug !== id && !out[slug]) {
      out[slug] = { ...compact, displayName: id };
    }
  }
  return out;
}

const mode = (process.argv[2] ?? "all").toLowerCase();

if (mode === "all" || mode === "cursor") {
  const res = await fetch(CURSOR_DOCS_URL);
  if (!res.ok) {
    console.error(`Failed to fetch Cursor docs: ${res.status}`);
    process.exit(1);
  }
  const md = await res.text();
  const cursor = parseCursorDocs(md);
  const count = Object.keys(cursor).length;
  if (count === 0) {
    console.error("Parsed 0 Cursor models — docs table format may have changed");
    process.exit(1);
  }
  const path = join(HARNESS_HOME, "model-prices.cursor.json");
  writeFileSync(
    path,
    `${JSON.stringify({ _meta: { source: CURSOR_DOCS_URL, refreshedAt: new Date().toISOString() }, ...cursor }, null, 2)}\n`,
  );
  console.log(`Cursor catalog: ${count} models → ${path}`);
}

if (mode === "all" || mode === "litellm") {
  const res = await fetch(LITELLM_URL);
  if (!res.ok) {
    console.error(`Failed to fetch LiteLLM prices: ${res.status}`);
    process.exit(1);
  }
  const raw = (await res.json()) as Record<string, LiteLlmEntry>;
  const litellm = parseLiteLlm(raw);
  const path = join(HARNESS_HOME, "model-prices.litellm.json");
  writeFileSync(
    path,
    `${JSON.stringify({
      _meta: {
        source: LITELLM_URL,
        refreshedAt: new Date().toISOString(),
        count: Object.keys(litellm).length,
      },
      ...litellm,
    })}\n`,
  );
  console.log(`LiteLLM catalog: ${Object.keys(litellm).length} models → ${path}`);
}
