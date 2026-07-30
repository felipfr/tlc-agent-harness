import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CapabilityCatalog, CatalogCapability } from "../src/core/capability/capability.types.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export type RenderTarget = { file: string; marker: string; render: (catalog: CapabilityCatalog) => string };

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function keys(capability: CatalogCapability): string {
  return `\`${capability.configPath}\``;
}

function asks(capability: CatalogCapability): string {
  const list = capability.asks ?? [];
  if (list.length === 0) {
    return capability.recommend ? `recommend **${capability.recommend}**` : "—";
  }
  const rendered = list.map((ask) => `\`${ask}\``).join(", ");
  return capability.recommend ? `${rendered}; recommend **${capability.recommend}**` : rendered;
}

export function renderSkillTable(catalog: CapabilityCatalog): string {
  const rows = catalog.capabilities.map((capability, index) =>
    [
      String(index + 1),
      cell(capability.title),
      keys(capability),
      capability.defaultOn ? "**on**" : "off",
      cell(capability.benefit),
      cell(capability.tradeOff),
      cell(asks(capability)),
    ].join(" | "),
  );
  return [
    "| # | Capability | Key | Default | Benefit | Trade-off | Extra asks if yes |",
    "|---|------------|-----|---------|---------|-----------|-------------------|",
    ...rows.map((row) => `| ${row} |`),
  ].join("\n");
}

export function renderRailsTable(catalog: CapabilityCatalog): string {
  const rows = catalog.capabilities.map((capability) =>
    [cell(capability.title), cell(capability.benefit), keys(capability)].join(" | "),
  );
  return [
    "| Rail | Effect | Status |",
    "|------|--------|--------|",
    ...rows.map((row) => `| ${row} |`),
  ].join("\n");
}

export const TARGETS: RenderTarget[] = [
  {
    file: join("skills", "harness-init", "references", "capabilities.md"),
    marker: "capabilities",
    render: renderSkillTable,
  },
  { file: join("docs", "architecture.md"), marker: "rails", render: renderRailsTable },
];

// invariant: only the marked region is owned by the generator. Everything else in these files is prose a
// catalog entry cannot express — the floor table, the always-ask section, the lessons subsection.
export function replaceRegion(text: string, marker: string, body: string): string {
  const open = `<!-- generated:${marker} -->`;
  const close = "<!-- /generated -->";
  const start = text.indexOf(open);
  if (start === -1) {
    throw new Error(`missing region marker ${open}`);
  }
  const end = text.indexOf(close, start);
  if (end === -1) {
    throw new Error(`unterminated region ${open}`);
  }
  return `${text.slice(0, start + open.length)}\n\n${body}\n\n${text.slice(end)}`;
}

export function loadCatalogFile(root = repoRoot): CapabilityCatalog {
  return JSON.parse(readFileSync(join(root, "capabilities", "catalog.json"), "utf8")) as CapabilityCatalog;
}

export function renderAll(root = repoRoot): { file: string; next: string; current: string }[] {
  const catalog = loadCatalogFile(root);
  return TARGETS.map((target) => {
    const path = join(root, target.file);
    const current = readFileSync(path, "utf8");
    return {
      file: target.file,
      current,
      next: replaceRegion(current, target.marker, target.render(catalog)),
    };
  });
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const results = renderAll();
  const stale = results.filter((result) => result.current !== result.next);

  if (!check) {
    for (const result of stale) {
      writeFileSync(join(repoRoot, result.file), result.next, "utf8");
    }
    console.log(`render-capabilities: ${stale.length} file(s) rewritten`);
    process.exit(0);
  }

  if (stale.length === 0) {
    console.log("render-capabilities: generated regions match the catalog");
    process.exit(0);
  }
  console.error(
    "render-capabilities: generated regions are out of date — run: node tools/render-capabilities.ts",
  );
  for (const result of stale) {
    console.error(`  ${result.file}`);
  }
  process.exit(1);
}
