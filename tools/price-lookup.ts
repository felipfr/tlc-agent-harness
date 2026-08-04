import { emitJson, takeJsonFlag } from "../src/platform/cli-output.ts";
import {
  type CostEstimate,
  estimateCostUsd,
  type PriceResolution,
  resolveModelPrice,
} from "../src/platform/pricing.ts";

export type PriceLookupArgs = { model: string; provider: string };
export type PriceLookupResult = {
  model: string;
  provider: string;
  resolved: PriceResolution | undefined;
  per1M: CostEstimate;
};

export function parsePriceLookupArgs(argv: readonly string[]): PriceLookupArgs | null {
  const model = argv[0];
  if (!model) {
    return null;
  }
  return { model, provider: argv[1] ?? "" };
}

export function lookupPrice(args: PriceLookupArgs): PriceLookupResult {
  const resolved = resolveModelPrice(args.provider, args.model);
  const per1M = estimateCostUsd(args.provider, args.model, {
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  return { model: args.model, provider: args.provider, resolved, per1M };
}

function main(): void {
  const { json, rest } = takeJsonFlag(process.argv.slice(2));
  const args = parsePriceLookupArgs(rest);
  if (!args) {
    console.error("usage: tlc harness prices lookup <model-id> [provider]");
    console.error(
      "   or: node --experimental-strip-types tools/price-lookup.ts <model-id> [provider]  (dev)",
    );
    process.exit(1);
  }
  const result = lookupPrice(args);
  if (json) {
    emitJson(result);
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
  if (!result.resolved) {
    process.exit(2);
  }
}

if (import.meta.main) {
  main();
}
