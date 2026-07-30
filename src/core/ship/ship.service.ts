import type { Decision } from "../../contracts/decision.ts";
import { isUnderCodePaths } from "../policy/policy.loader.ts";
import { hasRecentEvidence } from "./ship.ledger.ts";
import type { ShipClaim } from "./ship.types.ts";

const STRUCTURED = /(?:^|\n)\s*HARNESS_SHIP_CLAIM:\s*(.+?)\s*(?=\n|$)/;

export function detectShipClaim(text: string): ShipClaim | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }
  const structured = trimmed.match(STRUCTURED);
  const body = structured?.[1]?.trim();
  if (!body) {
    return null;
  }
  return {
    kind: "structured",
    snippet: `HARNESS_SHIP_CLAIM: ${body}`.slice(0, 280),
  };
}

export function pathExcluded(relativePath: string, excludes: string[]): boolean {
  const norm = relativePath.replace(/\\/g, "/");
  for (const raw of excludes) {
    const pattern = raw.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!pattern) {
      continue;
    }
    if (pattern.endsWith("/**")) {
      const base = pattern.slice(0, -3);
      if (norm === base || norm.startsWith(`${base}/`)) {
        return true;
      }
      continue;
    }
    if (pattern.endsWith("/")) {
      if (norm.startsWith(pattern) || norm.startsWith(`${pattern.slice(0, -1)}/`)) {
        return true;
      }
      continue;
    }
    if (pattern.includes("*")) {
      const re = new RegExp(
        `^${pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*\*/g, ".*")
          .replace(/\*/g, "[^/]*")}$`,
      );
      if (re.test(norm)) {
        return true;
      }
      continue;
    }
    if (norm === pattern || norm.startsWith(`${pattern}/`)) {
      return true;
    }
  }
  return false;
}

export function touchesRuntime(relativePaths: string[], prefixes: string[], excludes: string[]): boolean {
  return relativePaths.some((path) => {
    if (pathExcluded(path, excludes)) {
      return false;
    }
    return isUnderCodePaths(path, prefixes) || /^Dockerfile(\.|$)/.test(path);
  });
}

export function recentShipClaimActive(
  lastShipClaimAt: string | undefined,
  windowMinutes: number,
  now = Date.now(),
): boolean {
  if (!lastShipClaimAt) {
    return false;
  }
  const at = Date.parse(lastShipClaimAt);
  if (Number.isNaN(at)) {
    return false;
  }
  return now - at < windowMinutes * 60 * 1000;
}

export function evaluateEmptyDiffAntiShip(args: {
  enabled: boolean;
  recentShipClaim: boolean;
  changedFilesCount: number;
}): Decision {
  if (args.enabled && args.recentShipClaim && args.changedFilesCount === 0) {
    return {
      kind: "continue",
      text: [
        "BLOCKED: HARNESS_SHIP_CLAIM with no file diff.",
        "TRIED: inspected git working tree / changed files.",
        "NEED: either implement the remaining work or remove the ship claim — do not claim ship on an empty diff.",
      ].join("\n"),
    };
  }
  return { kind: "abstain" };
}

export function evaluateShipEvidenceGate(args: {
  enabled: boolean;
  recentShipClaim: boolean;
  changedFiles: string[];
  runtimePathPrefixes: string[];
  runtimePathExcludes: string[];
  evidenceDir: string | null;
  evidenceMaxAgeHours: number;
}): Decision {
  if (!args.enabled || !args.recentShipClaim || args.changedFiles.length === 0) {
    return { kind: "abstain" };
  }
  if (!touchesRuntime(args.changedFiles, args.runtimePathPrefixes, args.runtimePathExcludes)) {
    return { kind: "abstain" };
  }
  const hasEvidence =
    args.evidenceDir !== null && hasRecentEvidence(args.evidenceDir, args.evidenceMaxAgeHours);
  if (hasEvidence) {
    return { kind: "abstain" };
  }
  return {
    kind: "continue",
    text: [
      "BLOCKED: HARNESS_SHIP_CLAIM without recent production PASS evidence.",
      `TRIED: checked ${args.evidenceDir ?? "(no evidenceDir configured)"}/*/90-verdict.txt.`,
      "NEED: produce evidence and cite the verdict path, or remove the ship claim line.",
    ].join("\n"),
  };
}
