/**
 * why: `write-preserving` sits between `read` and `write` because "changes something" and "can lose something"
 * are different questions, and only the second is worth interrupting an operator for. Repeated approval of the
 * first becomes reflex, and a habituated reviewer is how the one consequential action gets waved through
 * ([/decisions/ad-026.md](/decisions/ad-026.md)).
 */
export type ShellEffectClass = "read" | "write-preserving" | "write" | "network" | "destructive";

export type ShellStallEntry = {
  lastCommand?: string;
  hits: number;
};

export type ShellStallStore = Record<string, ShellStallEntry>;
