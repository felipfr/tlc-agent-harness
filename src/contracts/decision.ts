export type Decision =
  | { kind: "abstain" }
  | { kind: "allow" }
  | { kind: "deny"; reason: string; userNote?: string }
  | { kind: "ask"; reason: string; userNote?: string }
  | { kind: "context"; text: string; env?: Record<string, string> }
  | { kind: "continue"; text: string }
  | { kind: "rewriteInput"; input: Record<string, unknown>; reason: string };

export type Rendered = {
  // invariant: null means write nothing; a provider whose abstain is a literal "{}" sets it explicitly.
  stdout: string | null;
  // invariant: always 0 — exit code is never used as a policy channel.
  exitCode: number;
};
