export type FingerprintEntry = {
  last?: string;
  hits: number;
};

export type FingerprintStore = Record<string, FingerprintEntry>;

export const STAGNATION_FOLLOWUP = [
  "BLOCKED: identical validation fingerprint repeated — no progress between attempts.",
  "TRIED: same gate failure signature as the previous stop loop.",
  "NEED: change approach. Do not repeat the same fix. Inspect root cause, try a different path, or escalate with BLOCKED/TRIED/NEED.",
].join("\n");
