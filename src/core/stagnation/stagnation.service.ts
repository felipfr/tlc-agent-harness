import { createHash } from "node:crypto";

export function computeFingerprint(parts: {
  files: string[];
  gate: string;
  exitCode: number;
  output: string;
}): string {
  const normalizedOutput = parts.output
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<ts>")
    .replace(/\b\d{5,}\b/g, "<n>")
    .slice(0, 1500);
  const raw = JSON.stringify({
    files: [...parts.files].sort(),
    gate: parts.gate,
    exitCode: parts.exitCode,
    output: normalizedOutput,
  });
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}
