/**
 * why: `write-preserving` sits between `read` and `write` because "changes something" and "can lose something"
 * are different questions, and only the second is worth interrupting an operator for. Repeated approval of the
 * first becomes reflex, and a habituated reviewer is how the one consequential action gets waved through
 * ([/decisions/ad-026.md](/decisions/ad-026.md)).
 *
 * hazard: `privilege` exists because that split, on its own, was the wrong axis for `chmod` and `chown`. Neither
 * loses a byte, so both were classified as preserving and stopped being asked about — which let
 * `chmod -R 777 .` through unremarked. Access is a third question, and the one whose answer never shows up in a
 * diff. It ranks above `write` for that reason: an overwrite inside a repository is recoverable and visible,
 * a widened permission is neither.
 */
export type ShellEffectClass =
  | "read"
  | "write-preserving"
  | "write"
  | "privilege"
  | "network"
  | "destructive";

export type ShellStallEntry = {
  lastCommand?: string;
  hits: number;
};

export type ShellStallStore = Record<string, ShellStallEntry>;
