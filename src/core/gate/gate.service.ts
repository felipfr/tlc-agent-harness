import { FINDINGS_MAX } from "./gate.artifact.ts";
import type { FailureCategory, GateGap, LastGateArtifact } from "./gate.types.ts";

export function gapsFromArtifact(args: {
  artifact: LastGateArtifact;
  category: FailureCategory;
  max?: number;
}): GateGap[] {
  const max = args.max ?? FINDINGS_MAX;
  const findings = args.artifact.findings.slice(0, max);
  if (findings.length === 0) {
    return [
      {
        id: `${args.artifact.gate}-0`,
        gate: args.artifact.gate,
        category: args.category,
        summary: `${args.artifact.gate} failed (exit ${args.artifact.exitCode})`,
      },
    ];
  }
  return findings.map((finding, index) => ({
    id: finding.id ?? `${args.artifact.gate}-${index}`,
    gate: args.artifact.gate,
    category: args.category,
    summary: finding.summary,
    detail: finding.detail,
  }));
}
