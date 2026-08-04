import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Decision } from "../../contracts/decision.ts";
import {
  flagsDir,
  policyBaselineDir,
  projectConfigPath,
  projectStateDir,
  runtimeHome,
} from "../../platform/paths.ts";
import { sanitizeSegment } from "../../platform/sanitize.ts";

export type PolicySource = { path: string; hash: string };

const ABSENT = "absent";
const SCHEMA = "harness.policy-baseline.v1";

// why: every file `loadPolicy` consults. A mutation that changed the effective policy without touching one
// of these would be a change the loader cannot see either.
const MODE_FILE = "harness-mode";
// why: every file the loader consults. The posture flags carry the posture names, so renaming a posture
// renames its flag — a stale file from the old spelling decides nothing and is not hashed.
const FLAG_FILES = ["grind-on", "skip-verify", "focus", "paired"];

function hashOf(path: string): string {
  if (!existsSync(path)) {
    return ABSENT;
  }
  try {
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  } catch {
    // hazard: an unreadable source must not read as unchanged, or a policy made unreadable mid-session
    // would pass silently. It gets its own marker instead.
    return "unreadable";
  }
}

export function policySourceFingerprint(root: string): PolicySource[] {
  const paths = [
    projectConfigPath(root),
    join(runtimeHome(), "config.json"),
    join(projectStateDir(root), MODE_FILE),
    ...FLAG_FILES.map((flag) => join(flagsDir(root), flag)),
  ];
  return paths.map((path) => ({ path, hash: hashOf(path) }));
}

function baselinePath(root: string, sessionKey: string): string {
  return join(policyBaselineDir(root), `${sanitizeSegment(sessionKey)}.json`);
}

export function recordPolicyBaseline(root: string, sessionKey: string): void {
  try {
    mkdirSync(policyBaselineDir(root), { recursive: true });
    writeFileSync(
      baselinePath(root, sessionKey),
      `${JSON.stringify({ schema: SCHEMA, sources: policySourceFingerprint(root) }, null, 2)}\n`,
      "utf8",
    );
  } catch {}
}

function readBaseline(root: string, sessionKey: string): PolicySource[] | null {
  const path = baselinePath(root, sessionKey);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { sources?: PolicySource[] };
    return Array.isArray(parsed.sources) ? parsed.sources : null;
  } catch {
    return null;
  }
}

/**
 * hazard: this compared every current source against the baseline, so a path the baseline had never heard of
 * counted as divergence. That is not a policy change — it means the harness's own list of policy sources grew
 * or was renamed, which happens on upgrade. Renaming a posture flag made this fire against its own author, and
 * it would have accused every operator with a live session of tampering the moment they updated the harness.
 *
 * invariant: only paths present in both are compared, and a hash that moved still fires. An out-of-band flag
 * write is caught because the baseline records absent sources too, so that source goes from `absent` to a hash
 * on a path the baseline already knows — detection is untouched.
 */
function firstDivergence(baseline: PolicySource[], current: PolicySource[]): string | null {
  const recorded = new Map(baseline.map((source) => [source.path, source.hash]));
  for (const source of current) {
    const was = recorded.get(source.path);
    if (was !== undefined && was !== source.hash) {
      return source.path;
    }
  }
  return null;
}

// invariant: this is the layer that covers what shell parsing cannot — `bash script.sh`, a compiled binary,
// a path built at runtime. It reads the policy's *bytes*, never its values, so nothing inside the policy can
// switch off the check that watches it.
export function checkPolicyBaseline(root: string, sessionKey: string): Decision {
  const baseline = readBaseline(root, sessionKey);
  // why: a missing baseline is the first hook of a session, not evidence of tampering. Recording and
  // allowing is the only safe reading — blocking here would break every fresh session.
  if (!baseline) {
    recordPolicyBaseline(root, sessionKey);
    return { kind: "allow" };
  }

  const diverged = firstDivergence(baseline, policySourceFingerprint(root));
  if (diverged === null) {
    return { kind: "allow" };
  }

  return {
    kind: "deny",
    reason: [
      `HARNESS: ${diverged} changed during this session, and no harness command changed it.`,
      "The gates are now running a policy the operator did not set, so what they check cannot be trusted.",
      "Tell the operator what changed and why; the harness commands re-record the baseline when they write.",
    ].join("\n"),
    userNote: `Harness policy changed out of band during this session: ${diverged}`,
  };
}

// why: the CLI is the sanctioned mutator, so after it writes, every live session's baseline is refreshed.
// It cannot know which sessions are live, which is exactly why it refreshes all of them — and it makes
// "a harness command did this" and "the baseline matches" the same fact, with no second log to drift.
export function refreshPolicyBaselines(root: string): void {
  const dir = policyBaselineDir(root);
  if (!existsSync(dir)) {
    return;
  }
  const sources = policySourceFingerprint(root);
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".json")) {
      continue;
    }
    try {
      writeFileSync(join(dir, entry), `${JSON.stringify({ schema: SCHEMA, sources }, null, 2)}\n`, "utf8");
    } catch {}
  }
}
